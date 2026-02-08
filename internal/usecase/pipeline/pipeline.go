package pipeline

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Pipeline coordinates the execution of all stages for a single word.
type Pipeline struct {
	stages       []*Stage
	validator    *Validator
	persistence  *Persistence
	taskRepo     repository.PipelineTaskRepository
	snapshotRepo repository.WordSnapshotRepository
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	logger       *slog.Logger
}

// ProcessWordResult contains the output of processing a single word.
type ProcessWordResult struct {
	Lemma    *entity.Lemma
	Tasks    []*entity.PipelineTask
	Snapshot *entity.WordSnapshot
}

// NewPipeline creates a new Pipeline coordinator.
func NewPipeline(
	stages []*Stage,
	validator *Validator,
	persistence *Persistence,
	taskRepo repository.PipelineTaskRepository,
	snapshotRepo repository.WordSnapshotRepository,
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	logger *slog.Logger,
) *Pipeline {
	return &Pipeline{
		stages:       stages,
		validator:    validator,
		persistence:  persistence,
		taskRepo:     taskRepo,
		snapshotRepo: snapshotRepo,
		lemmaRepo:    lemmaRepo,
		lexemeRepo:   lexemeRepo,
		logger:       logger,
	}
}

// Run executes the full pipeline for a given term.
func (p *Pipeline) Run(ctx context.Context, term string, language string, tier int32) (*ProcessWordResult, error) {
	// Apply defaults
	if language == "" {
		language = "en"
	}
	if tier == 0 {
		tier = 2
	}

	lang := entity.ParseLanguage(language)

	// Step 1: Ensure lemma exists
	pctx, err := p.validator.EnsureLemma(ctx, term, lang, tier)
	if err != nil {
		return nil, fmt.Errorf("ensure lemma: %w", err)
	}

	p.logger.Info("processing word", "term", term, "lemma_id", pctx.Lemma.ID)

	// Step 2: Create pipeline tasks for all stages
	for _, stage := range p.stages {
		_, err := p.taskRepo.CreateOrUpdate(ctx, &entity.PipelineTask{
			LemmaID: pctx.Lemma.ID,
			Phase:   int32(stage.Number),
			Status:  entity.TaskStatusPending,
			Tier:    tier,
		})
		if err != nil {
			return nil, fmt.Errorf("create task for stage %d: %w", stage.Number, err)
		}
	}

	// Step 3: Execute all stages
	for _, stage := range p.stages {
		if err := p.executeStage(ctx, pctx, stage); err != nil {
			p.logger.Error("stage failed",
				"stage", stage.Number,
				"name", stage.Name,
				"error", err)
			// Continue to next stage
		}
	}

	// Step 4: Gather final state
	tasks, err := p.taskRepo.ListByLemma(ctx, pctx.Lemma.ID)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}

	snapshot, _ := p.snapshotRepo.GetByLemma(ctx, pctx.Lemma.ID)

	return &ProcessWordResult{
		Lemma:    pctx.Lemma,
		Tasks:    tasks,
		Snapshot: snapshot,
	}, nil
}

// executeStage runs a single stage: all processors sequentially, then persists.
func (p *Pipeline) executeStage(ctx context.Context, pctx *PipelineContext, stage *Stage) error {
	phaseNum := int32(stage.Number)

	// No processors → skip
	if len(stage.Processors) == 0 {
		return p.updateTaskStatus(ctx, pctx.Lemma.ID, phaseNum, entity.TaskStatusSkipped, "")
	}

	// Mark as running
	if err := p.updateTaskStatus(ctx, pctx.Lemma.ID, phaseNum, entity.TaskStatusRunning, ""); err != nil {
		return err
	}

	p.logger.Info("executing stage", "stage", phaseNum, "name", stage.Name)

	// Accumulate results from all processors in this stage
	mergedResult := &ProcessResult{}

	for _, proc := range stage.Processors {
		result, err := proc.Process(ctx, pctx)
		if err != nil {
			errMsg := fmt.Sprintf("processor %s: %s", proc.Name(), err)
			_ = p.updateTaskStatus(ctx, pctx.Lemma.ID, phaseNum, entity.TaskStatusFailed, errMsg)
			return fmt.Errorf("processor %s: %w", proc.Name(), err)
		}

		if result == nil || result.Status == ProcessStatusSkipped || result.Status == ProcessStatusNoData {
			continue
		}

		// Merge processor result into context so next processor can see it
		pctx.Accumulate(result)

		// Also merge into stage-level result for persistence
		mergeProcessResults(mergedResult, result)
	}

	// Persist stage results
	if err := p.persistence.SaveStageResult(ctx, pctx.Lemma, mergedResult); err != nil {
		errMsg := fmt.Sprintf("persist error: %s", err)
		_ = p.updateTaskStatus(ctx, pctx.Lemma.ID, phaseNum, entity.TaskStatusFailed, errMsg)
		return fmt.Errorf("persist results: %w", err)
	}

	// Update lemma if any processor produced an update
	if mergedResult.LemmaUpdate != nil {
		updated := *mergedResult.LemmaUpdate
		updated.ID = pctx.Lemma.ID
		if _, err := p.lemmaRepo.Update(ctx, &updated); err != nil {
			errMsg := fmt.Sprintf("update lemma: %s", err)
			_ = p.updateTaskStatus(ctx, pctx.Lemma.ID, phaseNum, entity.TaskStatusFailed, errMsg)
			return fmt.Errorf("update lemma: %w", err)
		}
	}

	// Save snapshot if produced
	if mergedResult.Snapshot != nil {
		if err := p.persistence.SaveSnapshot(ctx, mergedResult.Snapshot); err != nil {
			errMsg := fmt.Sprintf("save snapshot: %s", err)
			_ = p.updateTaskStatus(ctx, pctx.Lemma.ID, phaseNum, entity.TaskStatusFailed, errMsg)
			return fmt.Errorf("save snapshot: %w", err)
		}
	}

	// Refresh context from DB (reload lexemes/forms that were persisted)
	p.refreshContext(ctx, pctx)

	// Mark completed
	if err := p.updateTaskStatus(ctx, pctx.Lemma.ID, phaseNum, entity.TaskStatusCompleted, ""); err != nil {
		return err
	}

	p.logger.Info("stage completed", "stage", phaseNum, "name", stage.Name)
	return nil
}

// refreshContext reloads lexemes and forms from DB after persistence.
func (p *Pipeline) refreshContext(ctx context.Context, pctx *PipelineContext) {
	// Reload lemma (may have updated QID, forms, etc.)
	lemma, err := p.lemmaRepo.GetByID(ctx, pctx.Lemma.ID)
	if err == nil {
		pctx.Lemma = lemma
		pctx.Forms = lemma.Forms
	}

	// Reload lexemes
	lexemes, err := p.lexemeRepo.ListByLemmaID(ctx, pctx.Lemma.ID)
	if err == nil {
		pctx.Lexemes = lexemes
	}
}

// updateTaskStatus updates the status of a pipeline task.
func (p *Pipeline) updateTaskStatus(ctx context.Context, lemmaID int64, phaseNum int32, status entity.TaskStatus, errorMsg string) error {
	task, err := p.taskRepo.GetByLemmaAndPhase(ctx, lemmaID, phaseNum)
	if err != nil {
		return fmt.Errorf("get task for phase %d: %w", phaseNum, err)
	}

	if err := p.taskRepo.UpdateStatus(ctx, task.ID, status, errorMsg); err != nil {
		return fmt.Errorf("update task status: %w", err)
	}

	return nil
}

// GetStatus returns the pipeline status for a given term.
func (p *Pipeline) GetStatus(ctx context.Context, term string, language string) ([]*entity.PipelineTask, error) {
	if p.lemmaRepo == nil {
		return nil, fmt.Errorf("pipeline not configured for status queries")
	}

	lang := entity.ParseLanguage(language)
	lemma, err := p.lemmaRepo.LookupByForm(ctx, term, lang)
	if err != nil {
		return nil, err
	}
	return p.taskRepo.ListByLemma(ctx, lemma.ID)
}

// GetSnapshot returns the snapshot for a given term.
func (p *Pipeline) GetSnapshot(ctx context.Context, term string, language string) (*entity.WordSnapshot, error) {
	if p.snapshotRepo == nil {
		return nil, fmt.Errorf("pipeline not configured for snapshot queries")
	}

	return p.snapshotRepo.GetByTerm(ctx, term, language)
}

// mergeProcessResults accumulates src into dst.
func mergeProcessResults(dst, src *ProcessResult) {
	if src == nil {
		return
	}
	dst.Evidence = append(dst.Evidence, src.Evidence...)
	dst.Lexemes = append(dst.Lexemes, src.Lexemes...)
	dst.Relations = append(dst.Relations, src.Relations...)
	dst.Forms = append(dst.Forms, src.Forms...)
	if src.FormsByLexeme != nil {
		if dst.FormsByLexeme == nil {
			dst.FormsByLexeme = make(map[string][]*entity.LemmaForm)
		}
		for k, v := range src.FormsByLexeme {
			dst.FormsByLexeme[k] = append(dst.FormsByLexeme[k], v...)
		}
	}
	if src.LemmaUpdate != nil {
		dst.LemmaUpdate = src.LemmaUpdate
	}
	if src.Snapshot != nil {
		dst.Snapshot = src.Snapshot
	}
}

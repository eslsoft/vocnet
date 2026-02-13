package pipeline

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Pipeline coordinates the execution of all stages for a single word.
type Pipeline struct {
	stages       []*Stage
	validator    *Validator
	persistence  *Persistence
	stageRepo    repository.PipelineStageRepository
	snapshotRepo repository.LemmaSnapshotRepository
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	evaluator    *DataEvaluator
	logger       *slog.Logger
}

// ProcessWordResult contains the output of processing a single word.
type ProcessWordResult struct {
	Lemma         *entity.Lemma
	Stages        []*entity.PipelineStage
	LemmaSnapshot *entity.LemmaSnapshot
}

// RunOptions carries optional per-run configuration.
type RunOptions struct {
	Logger *slog.Logger // job-scoped logger; falls back to Pipeline.logger if nil
}

// NewPipeline creates a new Pipeline coordinator.
func NewPipeline(
	stages []*Stage,
	validator *Validator,
	persistence *Persistence,
	stageRepo repository.PipelineStageRepository,
	snapshotRepo repository.LemmaSnapshotRepository,
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	evaluator *DataEvaluator,
	logger *slog.Logger,
) *Pipeline {
	return &Pipeline{
		stages:       stages,
		validator:    validator,
		persistence:  persistence,
		stageRepo:    stageRepo,
		snapshotRepo: snapshotRepo,
		lemmaRepo:    lemmaRepo,
		lexemeRepo:   lexemeRepo,
		evaluator:    evaluator,
		logger:       logger,
	}
}

// Run executes the full pipeline for a given term.
func (p *Pipeline) Run(ctx context.Context, jobID int64, term string, language string, tier int32, opts *RunOptions) (*ProcessWordResult, error) {
	runStart := time.Now()

	// Resolve logger
	runLogger := p.logger
	if opts != nil && opts.Logger != nil {
		runLogger = opts.Logger
	}

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
	if err := validateContextPOS(pctx); err != nil {
		return nil, fmt.Errorf("validate initial pos: %w", err)
	}

	// Set evaluator in context
	pctx.Evaluator = p.evaluator

	runLogger.Info("processing word", "term", term, "lemma_id", pctx.Lemma.ID)

	// Step 2: Create pipeline stages for all phases
	for _, stage := range p.stages {
		_, err := p.stageRepo.CreateOrUpdate(ctx, &entity.PipelineStage{
			JobID:   jobID,
			LemmaID: pctx.Lemma.ID,
			Phase:   int32(stage.Number),
			Status:  entity.StageStatusPending,
			Tier:    tier,
		})
		if err != nil {
			return nil, fmt.Errorf("create stage for phase %d: %w", stage.Number, err)
		}
	}

	// Step 3: Execute all stages
	for _, stage := range p.stages {
		if err := p.executeStage(ctx, jobID, pctx, stage, runLogger); err != nil {
			runLogger.Error("stage failed",
				"stage", stage.Number,
				"name", stage.Name,
				"error", err)
			return nil, fmt.Errorf("execute stage %d (%s): %w", stage.Number, stage.Name, err)
		}
	}

	runLogger.Info("pipeline run completed", "term", term, "duration", time.Since(runStart).String())

	// Step 4: Gather final state
	stages, err := p.stageRepo.ListByJob(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("list stages: %w", err)
	}

	lemmaSnapshot, _ := p.snapshotRepo.GetByLemma(ctx, pctx.Lemma.ID)

	return &ProcessWordResult{
		Lemma:         pctx.Lemma,
		Stages:        stages,
		LemmaSnapshot: lemmaSnapshot,
	}, nil
}

// executeStage runs a single stage: all processors sequentially, then persists.
func (p *Pipeline) executeStage(ctx context.Context, jobID int64, pctx *PipelineContext, stage *Stage, logger *slog.Logger) error {
	phaseNum := int32(stage.Number)
	stageStart := time.Now()

	// No processors → skip
	if len(stage.Processors) == 0 {
		return p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusSkipped, "")
	}

	// Mark as running
	if err := p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusRunning, ""); err != nil {
		return err
	}

	logger.Info("executing stage", "stage", phaseNum, "name", stage.Name)

	// Accumulate results from all processors in this stage
	mergedResult := &ProcessResult{}
	executedCount := 0

	for _, proc := range stage.Processors {
		procStart := time.Now()
		result, err := proc.Process(ctx, pctx)
		if err != nil {
			// Processor skipped (not configured) → log and continue
			var skipErr *ErrProcessorSkipped
			if errors.As(err, &skipErr) {
				logger.Warn("processor skipped", "processor", proc.Name(), "reason", skipErr.Reason)
				continue
			}

			// Real error → fail the stage
			errMsg := fmt.Sprintf("processor %s: %s", proc.Name(), err)
			_ = p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusFailed, errMsg)
			return fmt.Errorf("processor %s: %w", proc.Name(), err)
		}

		if result == nil || result.Status == ProcessStatusNoData {
			logger.Debug("processor completed", "processor", proc.Name(), "status", "no_data", "duration", time.Since(procStart).String())
			continue
		}

		executedCount++
		logger.Debug("processor completed", "processor", proc.Name(), "status", "executed", "duration", time.Since(procStart).String())

		// Merge processor result into context so next processor can see it
		// Use AccumulateWithProvider if result has provider metadata
		if result.Provider != "" {
			pctx.AccumulateWithProvider(result, result.Provider)
		} else {
			pctx.Accumulate(result)
		}
		if err := validateContextPOS(pctx); err != nil {
			errMsg := fmt.Sprintf("processor %s: %s", proc.Name(), err)
			_ = p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusFailed, errMsg)
			return fmt.Errorf("processor %s: %w", proc.Name(), err)
		}

		// Also merge into stage-level result for persistence
		mergeProcessResults(mergedResult, result)
	}

	// All processors skipped → mark stage as skipped
	if executedCount == 0 {
		if err := p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusSkipped, ""); err != nil {
			return err
		}
		logger.Info("stage skipped", "stage", phaseNum, "name", stage.Name, "duration", time.Since(stageStart).String())
		return nil
	}

	// Persist stage results
	if err := p.persistence.SaveStageResult(ctx, pctx.Lemma, mergedResult); err != nil {
		errMsg := fmt.Sprintf("persist error: %s", err)
		_ = p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusFailed, errMsg)
		return fmt.Errorf("persist results: %w", err)
	}

	// Update lemma if any processor produced an update
	if mergedResult.LemmaUpdate != nil {
		updated := *mergedResult.LemmaUpdate
		updated.ID = pctx.Lemma.ID
		if _, err := p.lemmaRepo.Update(ctx, &updated); err != nil {
			errMsg := fmt.Sprintf("update lemma: %s", err)
			_ = p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusFailed, errMsg)
			return fmt.Errorf("update lemma: %w", err)
		}
	}

	// Save lemma snapshot if produced.
	if mergedResult.LemmaSnapshot != nil {
		if err := p.persistence.SaveLemmaSnapshot(ctx, jobID, pctx.Lemma, pctx.Forms, mergedResult.LemmaSnapshot); err != nil {
			errMsg := fmt.Sprintf("save snapshot: %s", err)
			_ = p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusFailed, errMsg)
			return fmt.Errorf("save snapshot: %w", err)
		}
	}

	// Mark completed
	if err := p.updateStageStatus(ctx, jobID, phaseNum, entity.StageStatusCompleted, ""); err != nil {
		return err
	}

	logger.Info("stage completed", "stage", phaseNum, "name", stage.Name, "duration", time.Since(stageStart).String())
	return nil
}

func validateContextPOS(pctx *PipelineContext) error {
	if pctx == nil {
		return nil
	}
	for _, lex := range pctx.Lexemes {
		if lex == nil {
			continue
		}
		if !entity.IsValidPartOfSpeech(lex.PartOfSpeech) {
			return fmt.Errorf("invalid pos for lexeme %s: %q", lex.ExternalID, lex.PartOfSpeech)
		}
	}
	return nil
}

// updateStageStatus updates the status of a pipeline stage.
func (p *Pipeline) updateStageStatus(ctx context.Context, jobID int64, phaseNum int32, status entity.StageStatus, errorMsg string) error {
	stage, err := p.stageRepo.GetByJobAndPhase(ctx, jobID, phaseNum)
	if err != nil {
		return fmt.Errorf("get stage for phase %d: %w", phaseNum, err)
	}

	if err := p.stageRepo.UpdateStatus(ctx, stage.ID, status, errorMsg); err != nil {
		return fmt.Errorf("update stage status: %w", err)
	}

	return nil
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
	if src.LemmaSnapshot != nil {
		dst.LemmaSnapshot = src.LemmaSnapshot
	}
}

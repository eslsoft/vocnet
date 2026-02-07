package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Orchestrator coordinates the five pipeline phases for a single word.
type Orchestrator struct {
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	evidenceRepo repository.EvidenceRepository
	taskRepo     repository.PipelineTaskRepository
	relationRepo repository.SemanticRelationRepository
	snapshotRepo repository.WordSnapshotRepository
	phases       []Phase
	logger       *slog.Logger
}

// NewOrchestrator creates a pipeline orchestrator with all dependencies.
func NewOrchestrator(
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	evidenceRepo repository.EvidenceRepository,
	taskRepo repository.PipelineTaskRepository,
	relationRepo repository.SemanticRelationRepository,
	snapshotRepo repository.WordSnapshotRepository,
	phases []Phase,
	logger *slog.Logger,
) *Orchestrator {
	return &Orchestrator{
		lemmaRepo:    lemmaRepo,
		lexemeRepo:   lexemeRepo,
		evidenceRepo: evidenceRepo,
		taskRepo:     taskRepo,
		relationRepo: relationRepo,
		snapshotRepo: snapshotRepo,
		phases:       phases,
		logger:       logger,
	}
}

// ProcessWordResult contains the output of processing a single word.
type ProcessWordResult struct {
	Lemma    *entity.Lemma
	Tasks    []*entity.PipelineTask
	Snapshot *entity.WordSnapshot
}

// ProcessWord runs the full pipeline for a given term.
func (o *Orchestrator) ProcessWord(ctx context.Context, term string, language string, tier int32) (*ProcessWordResult, error) {
	if language == "" {
		language = "en"
	}
	if tier == 0 {
		tier = 2
	}

	// Step 1: Find or create lemma by normalized form
	lemma, err := o.findOrCreateLemma(ctx, term, language)
	if err != nil {
		return nil, fmt.Errorf("find or create lemma: %w", err)
	}

	o.logger.Info("processing word", "term", term, "lemma_id", lemma.ID)

	// Step 2: Create pipeline tasks for each phase
	for _, phase := range o.phases {
		_, err := o.taskRepo.CreateOrUpdate(ctx, &entity.PipelineTask{
			LemmaID: lemma.ID,
			Phase:   int32(phase.Number()),
			Status:  entity.TaskStatusPending,
			Tier:    tier,
		})
		if err != nil {
			return nil, fmt.Errorf("create task for phase %d: %w", phase.Number(), err)
		}
	}

	// Step 3: Execute phases sequentially
	for _, phase := range o.phases {
		task, err := o.taskRepo.GetByLemmaAndPhase(ctx, lemma.ID, int32(phase.Number()))
		if err != nil {
			return nil, fmt.Errorf("get task for phase %d: %w", phase.Number(), err)
		}

		// Mark as running
		if err := o.taskRepo.UpdateStatus(ctx, task.ID, entity.TaskStatusRunning, ""); err != nil {
			return nil, fmt.Errorf("update task status: %w", err)
		}

		o.logger.Info("executing phase", "phase", phase.Number(), "name", phase.Name())

		result, err := phase.Execute(ctx, lemma)
		if err != nil {
			errMsg := err.Error()
			_ = o.taskRepo.UpdateStatus(ctx, task.ID, entity.TaskStatusFailed, errMsg)
			o.logger.Error("phase failed", "phase", phase.Number(), "name", phase.Name(), "error", err)
			continue // continue to next phase
		}

		// Persist results
		if err := o.persistPhaseResult(ctx, lemma, result); err != nil {
			errMsg := fmt.Sprintf("persist error: %s", err)
			_ = o.taskRepo.UpdateStatus(ctx, task.ID, entity.TaskStatusFailed, errMsg)
			o.logger.Error("persist failed", "phase", phase.Number(), "error", err)
			continue
		}

		// Mark as completed (or skipped if the result is empty)
		status := entity.TaskStatusCompleted
		if result == nil {
			status = entity.TaskStatusSkipped
		} else {
			// Update lemma if phase produced lemma updates
			if result.LemmaUpdate != nil {
				lemma = result.LemmaUpdate
			}
		}

		if err := o.taskRepo.UpdateStatus(ctx, task.ID, status, ""); err != nil {
			return nil, fmt.Errorf("update task status: %w", err)
		}

		o.logger.Info("phase completed", "phase", phase.Number(), "name", phase.Name())
	}

	// Gather final state
	tasks, err := o.taskRepo.ListByLemma(ctx, lemma.ID)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}

	snapshot, _ := o.snapshotRepo.GetByLemma(ctx, lemma.ID) // may not exist yet

	return &ProcessWordResult{
		Lemma:    lemma,
		Tasks:    tasks,
		Snapshot: snapshot,
	}, nil
}

// findOrCreateLemma looks up an existing lemma or creates a minimal one.
// In the pipeline, if a word doesn't exist, we create a minimal lexeme + lemma + form
// so that the pipeline phases have a valid lemma ID to anchor their work.
func (o *Orchestrator) findOrCreateLemma(ctx context.Context, term string, language string) (*entity.Lemma, error) {
	lang := entity.ParseLanguage(language)

	// Try to find by form
	lemma, err := o.lemmaRepo.LookupByForm(ctx, term, lang)
	if err == nil {
		return lemma, nil
	}

	// Not found — create a minimal lexeme + lemma + form structure
	normalized := strings.ToLower(strings.TrimSpace(term))
	externalID := fmt.Sprintf("pipeline-%s-%s-%d", language, normalized, time.Now().UnixNano())

	// Create minimal lexeme
	lexeme, err := o.lexemeRepo.Create(ctx, &entity.Lexeme{
		ExternalID:   externalID,
		Language:     lang,
		PartOfSpeech: "",
		EntryType:    entity.LexemeEntryTypeWord,
		Senses:       []entity.LexemeSense{},
		Categories:   []string{},
	})
	if err != nil {
		return nil, fmt.Errorf("create lexeme: %w", err)
	}

	// Create minimal lemma + form for this lexeme
	lemma, err = o.lemmaRepo.CreateMinimal(ctx, lexeme.ID, term, lang)
	if err != nil {
		return nil, fmt.Errorf("create lemma: %w", err)
	}

	o.logger.Info("created minimal lemma for pipeline", "term", term, "lemma_id", lemma.ID, "lexeme_id", lexeme.ID)
	return lemma, nil
}

// persistPhaseResult saves the outputs of a phase execution.
func (o *Orchestrator) persistPhaseResult(ctx context.Context, lemma *entity.Lemma, result *PhaseResult) error {
	if result == nil {
		return nil
	}

	// Save evidence
	for _, ev := range result.Evidence {
		ev.LemmaID = lemma.ID
		if _, err := o.evidenceRepo.Create(ctx, ev); err != nil {
			return fmt.Errorf("save evidence: %w", err)
		}
	}

	// Save relations
	if len(result.Relations) > 0 {
		if _, err := o.relationRepo.BatchCreate(ctx, result.Relations); err != nil {
			return fmt.Errorf("save relations: %w", err)
		}
	}

	return nil
}

// GetStatus returns the pipeline status for a given term.
func (o *Orchestrator) GetStatus(ctx context.Context, term string, language string) ([]*entity.PipelineTask, error) {
	lang := entity.ParseLanguage(language)
	lemma, err := o.lemmaRepo.LookupByForm(ctx, term, lang)
	if err != nil {
		return nil, err
	}
	return o.taskRepo.ListByLemma(ctx, lemma.ID)
}

// GetSnapshot returns the snapshot for a given term.
func (o *Orchestrator) GetSnapshot(ctx context.Context, term string, language string) (*entity.WordSnapshot, error) {
	return o.snapshotRepo.GetByTerm(ctx, term, language)
}

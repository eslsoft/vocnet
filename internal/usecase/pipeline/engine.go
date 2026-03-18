package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/persist"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
	"github.com/eslsoft/vocnet/pkg/pipeline"
)

type VocnetPipeline struct {
	inner        *pipeline.Pipeline[*PipelineContext, *ProcessResult]
	stages       []*Stage
	validator    *Validator
	persistence  *persist.Persistence
	stageRepo    repository.PipelineStageRepository
	snapshotRepo repository.LemmaSnapshotRepository
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	evaluator    *scoring.DataEvaluator
	logger       *slog.Logger
	lemmaLocks   sync.Map // map[string]*sync.Mutex — per-lemma mutex keyed by normalized surface
}

type ProcessWordResult struct {
	Lemma         *entity.Lemma
	Stages        []*entity.PipelineStage
	LemmaSnapshot *entity.LemmaSnapshot
}

type RunOptions struct {
	Logger *slog.Logger
}

func NewVocnetPipeline(
	stages []*Stage,
	validator *Validator,
	persistence *persist.Persistence,
	stageRepo repository.PipelineStageRepository,
	snapshotRepo repository.LemmaSnapshotRepository,
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	evaluator *scoring.DataEvaluator,
	logger *slog.Logger,
) *VocnetPipeline {
	vp := &VocnetPipeline{
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

	vp.inner = pipeline.NewPipeline[*PipelineContext, *ProcessResult](
		stages,
		func(pctx *PipelineContext, res *ProcessResult) {
			pctx.Accumulate(res)
		},
		func(dst, src *ProcessResult) *ProcessResult {
			if dst == nil {
				dst = &ProcessResult{}
			}
			mergeProcessResults(dst, src)
			return dst
		},
		vp,
		nil, // TODO: Metrics
		logger,
	)

	return vp
}

// acquireLemmaLock returns a mutex for the given normalized lemma surface.
// Multiple workers processing terms that map to the same lemma will serialize.
func (p *VocnetPipeline) acquireLemmaLock(normalized string) *sync.Mutex {
	actual, _ := p.lemmaLocks.LoadOrStore(normalized, &sync.Mutex{})
	mu := actual.(*sync.Mutex)
	mu.Lock()
	return mu
}

func (p *VocnetPipeline) Run(ctx context.Context, jobID int64, term string, language string, tier int32, opts *RunOptions) (*ProcessWordResult, error) {
	if language == "" {
		language = "en"
	}
	if tier == 0 {
		tier = 2
	}
	lang := entity.ParseLanguage(language)

	pctx, err := p.validator.EnsureLemma(ctx, term, lang, tier)
	if err != nil {
		return nil, fmt.Errorf("ensure lemma: %w", err)
	}
	if err := validateContextPOS(pctx); err != nil {
		return nil, fmt.Errorf("validate initial pos: %w", err)
	}

	pctx.JobID = jobID
	pctx.Evaluator = p.evaluator

	if err := p.inner.Run(ctx, pctx); err != nil {
		return nil, err
	}

	stages, err := p.stageRepo.ListByJob(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("list stages: %w", err)
	}

	var lemmaSnapshot *entity.LemmaSnapshot
	if pctx.Lemma != nil {
		lemmaSnapshot, _ = p.snapshotRepo.GetByLemma(ctx, pctx.Lemma.ID)
	}

	return &ProcessWordResult{
		Lemma:         pctx.Lemma,
		Stages:        stages,
		LemmaSnapshot: lemmaSnapshot,
	}, nil
}

// Hooks implementation

func (p *VocnetPipeline) OnStageStart(ctx context.Context, pctx *PipelineContext, stage *Stage) error {
	phaseNum := int32(stage.Number)

	// Create stage record only when lemma is resolved (FK constraint)
	if pctx.Lemma != nil {
		if _, err := p.stageRepo.CreateOrUpdate(ctx, &entity.PipelineStage{
			JobID:   pctx.JobID,
			LemmaID: pctx.Lemma.ID,
			Phase:   phaseNum,
			Status:  entity.StageStatusPending,
			Tier:    pctx.Tier,
		}); err != nil {
			return fmt.Errorf("create stage for phase %d: %w", phaseNum, err)
		}
	}

	if len(stage.Processors) == 0 {
		return p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusSkipped, "")
	}
	return p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusRunning, "")
}

func (p *VocnetPipeline) OnStageEnd(ctx context.Context, stage *Stage, pctx *PipelineContext, mergedResult *ProcessResult, err error) error {
	phaseNum := int32(stage.Number)

	if err != nil {
		_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
		return nil
	}

	if mergedResult == nil {
		return p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusSkipped, "")
	}

	// Acquire per-lemma lock to serialize DB writes for the same lemma.
	// Different terms (e.g., "abandoned", "abandon") may resolve to the same lemma
	// and must not write concurrently.
	if writeErr := p.writeStageResultWithLock(ctx, pctx, phaseNum, mergedResult); writeErr != nil {
		return writeErr
	}

	return p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusCompleted, "")
}

// writeStageResultWithLock serializes all DB writes for the same lemma.
// Different terms that resolve to the same lemma must not write concurrently.
// Term is already resolved to the canonical lemma surface at job submission time.
func (p *VocnetPipeline) writeStageResultWithLock(ctx context.Context, pctx *PipelineContext, phaseNum int32, mergedResult *ProcessResult) error {
	lockKey := strings.ToLower(strings.TrimSpace(pctx.Term))

	mu := p.acquireLemmaLock(lockKey)
	defer mu.Unlock()

	// Create or find the lemma using the pre-resolved term.
	if err := p.createLemma(ctx, pctx, pctx.Term); err != nil {
		_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
		return err
	}

	// Persist evidence (raw source data from Collection processors).
	if len(mergedResult.Evidence) > 0 {
		if err := p.persistence.SaveEvidence(ctx, pctx.Lemma, mergedResult.Evidence); err != nil {
			_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
			return err
		}
	}

	// Persist forms, lexemes, and relations (only from Integration stage).
	if len(mergedResult.Lexemes) > 0 || len(mergedResult.Forms) > 0 || len(mergedResult.FormsByLexeme) > 0 || len(mergedResult.Relations) > 0 {
		if err := p.persistence.SaveIntegrationResult(ctx, pctx.Lemma, mergedResult); err != nil {
			_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
			return err
		}
	}

	if mergedResult.LemmaUpdate != nil {
		updated := *mergedResult.LemmaUpdate
		updated.ID = pctx.Lemma.ID
		if _, err := p.lemmaRepo.Update(ctx, &updated); err != nil {
			_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
			return err
		}
	}

	if mergedResult.LemmaSnapshot != nil {
		if err := p.persistence.SaveLemmaSnapshot(ctx, pctx.JobID, pctx.Lemma, pctx.Forms, pctx.VariantSurfaces, mergedResult.LemmaSnapshot); err != nil {
			_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
			return err
		}
	}

	return nil
}

func (p *VocnetPipeline) OnProcessorStart(ctx context.Context, pctx *PipelineContext, stage *Stage, proc Processor) {
}

func (p *VocnetPipeline) OnProcessorEnd(ctx context.Context, pctx *PipelineContext, stage *Stage, proc Processor, result *ProcessResult, err error, duration time.Duration) {
	if err != nil {
		if !pipeline.IsProcessorSkipped(err) {
			p.logger.Error("processor failed", "processor", proc.Name(), "error", err)
		}
		return
	}
	if err := validateContextPOS(pctx); err != nil {
		p.logger.Error("invalid POS after processor", "processor", proc.Name(), "error", err)
	}
}

func (p *VocnetPipeline) updateStageStatus(ctx context.Context, jobID int64, phaseNum int32, status entity.StageStatus, errorMsg string) error {
	stage, err := p.stageRepo.GetByJobAndPhase(ctx, jobID, phaseNum)
	if err != nil {
		return err
	}
	return p.stageRepo.UpdateStatus(ctx, stage.ID, status, errorMsg)
}

// ensureAndUpdateStageStatus creates the stage record if it doesn't exist yet
// (lemma was resolved after stage started), then updates its status.
func (p *VocnetPipeline) ensureAndUpdateStageStatus(ctx context.Context, pctx *PipelineContext, phaseNum int32, status entity.StageStatus, errorMsg string) error {
	if pctx.Lemma != nil {
		// Ensure record exists (may have been skipped in OnStageStart when lemma was nil)
		if _, err := p.stageRepo.CreateOrUpdate(ctx, &entity.PipelineStage{
			JobID:   pctx.JobID,
			LemmaID: pctx.Lemma.ID,
			Phase:   phaseNum,
			Status:  entity.StageStatusPending,
			Tier:    pctx.Tier,
		}); err != nil {
			return fmt.Errorf("ensure stage for phase %d: %w", phaseNum, err)
		}
		return p.updateStageStatus(ctx, pctx.JobID, phaseNum, status, errorMsg)
	}
	// No lemma yet — stage record can't be created, skip silently
	return nil
}

// --- WorkerPool ---

type WorkerPool = pipeline.WorkerPool[pipelineJobWrapper]

type pipelineJobWrapper struct {
	*entity.PipelineJob
}

func (j pipelineJobWrapper) ID() any { return j.PipelineJob.ID }

func NewWorkerPool(
	jobRepo repository.PipelineJobRepository,
	pipelineEngine *VocnetPipeline,
	logger *slog.Logger,
	workerCount int,
	pollInterval time.Duration,
	metrics pipeline.Metrics,
) *WorkerPool {
	return pipeline.NewWorkerPool(
		pipeline.WorkerPoolConfig{
			WorkerCount:  workerCount,
			PollInterval: pollInterval,
		},
		func(ctx context.Context, batchSize int) ([]pipelineJobWrapper, int64, error) {
			count, err := jobRepo.CountByStatus(ctx, entity.JobStatusPending)
			if err != nil {
				return nil, 0, err
			}

			jobs, err := jobRepo.ClaimNextBatch(ctx, batchSize)
			if err != nil {
				return nil, int64(count), err
			}
			wrapped := make([]pipelineJobWrapper, len(jobs))
			for i, j := range jobs {
				wrapped[i] = pipelineJobWrapper{j}
			}
			return wrapped, int64(count), nil
		},
		func(ctx context.Context, job pipelineJobWrapper) error {
			_, err := pipelineEngine.Run(ctx, job.PipelineJob.ID, job.Term, job.Language, job.Tier, nil)
			if err != nil {
				_ = jobRepo.UpdateStatus(ctx, job.PipelineJob.ID, entity.JobStatusFailed, err.Error())
				return err
			}
			return jobRepo.UpdateStatus(ctx, job.PipelineJob.ID, entity.JobStatusCompleted, "")
		},
		metrics,
		logger,
	)
}

// --- Validator ---

type Validator struct {
	logger *slog.Logger
}

func NewValidator(logger *slog.Logger) *Validator {
	return &Validator{logger: logger}
}

// EnsureLemma creates a clean pipeline context for the given term.
// Term is already resolved to canonical lemma surface at job submission time.
func (v *Validator) EnsureLemma(_ context.Context, term string, language entity.Language, tier int32) (*PipelineContext, error) {
	return &PipelineContext{Term: term, Language: language, Tier: tier}, nil
}

func (p *VocnetPipeline) createLemma(ctx context.Context, pctx *PipelineContext, surface string) error {
	lemma, err := p.lemmaRepo.CreateMinimal(ctx, surface, pctx.Language)
	if err != nil {
		return fmt.Errorf("create lemma %q: %w", surface, err)
	}
	pctx.Lemma = lemma
	return nil
}

// --- Helpers ---

func validateContextPOS(pctx *PipelineContext) error {
	for _, lex := range pctx.Lexemes {
		if lex != nil && !entity.IsValidPartOfSpeech(lex.PartOfSpeech) {
			return fmt.Errorf("invalid pos for lexeme %s: %q", lex.ExternalID, lex.PartOfSpeech)
		}
	}
	return nil
}

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

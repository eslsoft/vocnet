package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
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

	// After collection: resolve or correct lemma based on collected data.
	if pctx.Lemma == nil {
		// New word: create lemma with the true base form from data sources.
		if err := p.createLemmaFromCollectedData(ctx, pctx); err != nil {
			_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
			return err
		}
	} else {
		// Existing lemma: correct surface if data sources reveal a better base form.
		// Fixes stale data where old code created lemmas with wrong surfaces
		// (e.g., "better" instead of "good").
		p.correctLemmaSurface(ctx, pctx)
	}

	if err := p.persistence.SaveStageResult(ctx, pctx.Lemma, mergedResult); err != nil {
		_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
		return err
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
		if err := p.persistence.SaveLemmaSnapshot(ctx, pctx.JobID, pctx.Lemma, pctx.Forms, mergedResult.LemmaSnapshot); err != nil {
			_ = p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusFailed, err.Error())
			return err
		}
	}

	return p.ensureAndUpdateStageStatus(ctx, pctx, phaseNum, entity.StageStatusCompleted, "")
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
	lemmaRepo  repository.LemmaRepository
	lexemeRepo repository.LexemeRepository
	logger     *slog.Logger
}

func NewValidator(lemmaRepo repository.LemmaRepository, lexemeRepo repository.LexemeRepository, logger *slog.Logger) *Validator {
	return &Validator{lemmaRepo: lemmaRepo, lexemeRepo: lexemeRepo, logger: logger}
}

func (v *Validator) EnsureLemma(ctx context.Context, term string, language entity.Language, tier int32) (*PipelineContext, error) {
	pctx := &PipelineContext{Term: term, Language: language, Tier: tier}
	existing, err := v.lemmaRepo.LookupByForm(ctx, term, language)
	if err == nil {
		pctx.Lemma = existing
		lexemes, _ := v.lexemeRepo.ListByLemmaID(ctx, existing.ID)
		pctx.Lexemes = lexemes
		pctx.Forms = existing.Forms
	}
	// If not found, pctx.Lemma stays nil.
	// Lemma will be created after collection phase discovers the true base form.
	return pctx, nil
}

// createLemmaFromCollectedData creates the lemma record using the true base form
// discovered by data sources. Returns error if no LEMMA form was found.
func (p *VocnetPipeline) createLemmaFromCollectedData(ctx context.Context, pctx *PipelineContext) error {
	best := shortestLemmaFormSurface(pctx.Forms)
	if best == "" {
		return fmt.Errorf("no LEMMA form found for term %q: data sources did not provide a base form", pctx.Term)
	}
	return p.createLemma(ctx, pctx, best)
}

// shortestLemmaFormSurface returns the shortest LEMMA-type form surface.
// The shortest form is most likely the canonical base form
// (e.g., "child" over "child's", "work" over "working").
func shortestLemmaFormSurface(forms []*entity.LemmaForm) string {
	var best string
	for _, f := range forms {
		if f == nil || f.FormType != entity.FormTypeLemma || f.Surface == "" {
			continue
		}
		if best == "" || len(f.Surface) < len(best) {
			best = f.Surface
		}
	}
	return best
}

// correctLemmaSurface checks if the existing lemma surface should be updated
// based on the shortest LEMMA form from collected data. This fixes stale records
// where old code wrote wrong surfaces (e.g., lemma "better" should be "good").
func (p *VocnetPipeline) correctLemmaSurface(ctx context.Context, pctx *PipelineContext) {
	best := shortestLemmaFormSurface(pctx.Forms)
	if best == "" || strings.EqualFold(best, pctx.Lemma.Surface) {
		return
	}
	oldSurface := pctx.Lemma.Surface
	pctx.Lemma.Surface = best
	pctx.Lemma.Normalized = strings.ToLower(best)
	if _, err := p.lemmaRepo.Update(ctx, pctx.Lemma); err != nil {
		// UNIQUE constraint: a lemma with the correct surface already exists.
		// Switch to that lemma instead of staying on the wrong one.
		pctx.Lemma.Surface = oldSurface
		pctx.Lemma.Normalized = strings.ToLower(oldSurface)
		existing, lookupErr := p.lemmaRepo.LookupByForm(ctx, best, pctx.Language)
		if lookupErr == nil && existing != nil {
			pctx.Lemma = existing
			pctx.Forms = existing.Forms
			lexemes, _ := p.lexemeRepo.ListByLemmaID(ctx, existing.ID)
			pctx.Lexemes = lexemes
		} else {
			p.logger.Warn("failed to correct lemma surface", "from", oldSurface, "to", best, "error", err)
		}
	}
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
	if src.SyncForms {
		dst.SyncForms = true
		dst.SourceFormKeys = src.SourceFormKeys
	}
}

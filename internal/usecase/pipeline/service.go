package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// LemmaResolver resolves a term to its Wikidata lemma surfaces.
// For example, "working" → ["work", "working"], "ate" → ["eat"].
type LemmaResolver interface {
	ResolveLemmas(ctx context.Context, term string, language string) ([]string, error)
}

// PipelineService is the facade for submitting and querying pipeline jobs.
type PipelineService struct {
	jobRepo  repository.PipelineJobRepository
	stageRepo repository.PipelineStageRepository
	resolver LemmaResolver
	logger   *slog.Logger
}

// NewPipelineService creates a new PipelineService.
func NewPipelineService(
	jobRepo repository.PipelineJobRepository,
	stageRepo repository.PipelineStageRepository,
	resolver LemmaResolver,
	logger *slog.Logger,
) *PipelineService {
	return &PipelineService{
		jobRepo:   jobRepo,
		stageRepo: stageRepo,
		resolver:  resolver,
		logger:    logger,
	}
}

// resolveTermToLemmas converts a term to its Wikidata lemma surface(s).
// A single term can map to multiple lemmas (e.g., "does" → ["doe", "do"]).
// Returns error if resolver is not configured, fails, or finds no lemma.
func (s *PipelineService) resolveTermToLemmas(ctx context.Context, term, language string) ([]string, error) {
	lemmas, err := s.resolver.ResolveLemmas(ctx, term, language)
	if err != nil {
		return nil, fmt.Errorf("resolve lemmas for %q: %w", term, err)
	}
	if len(lemmas) == 0 {
		return nil, fmt.Errorf("no lemma found for %q", term)
	}
	return lemmas, nil
}

// SubmitJob resolves a term to its lemma surface(s) and creates pipeline jobs.
// A term may resolve to multiple lemmas (e.g., "does" → ["do", "doe"]),
// each getting its own job.
func (s *PipelineService) SubmitJob(ctx context.Context, term, language string, tier int32, name string) ([]*entity.PipelineJob, error) {
	term = strings.TrimSpace(term)
	if term == "" {
		return nil, fmt.Errorf("term is required")
	}
	if language == "" {
		language = "en"
	}
	if tier == 0 {
		tier = 2
	}

	lemmas, err := s.resolveTermToLemmas(ctx, term, language)
	if err != nil {
		return nil, fmt.Errorf("submit %q: %w", term, err)
	}
	var jobs []*entity.PipelineJob
	for _, lemma := range lemmas {
		jobName := strings.TrimSpace(name)
		if jobName == "" {
			jobName = fmt.Sprintf("word: %s", lemma)
		}
		job := &entity.PipelineJob{
			Status:   entity.JobStatusPending,
			Name:     jobName,
			Language: language,
			Tier:     tier,
			Term:     lemma,
		}
		created, err := s.jobRepo.Create(ctx, job)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, created)
	}
	return jobs, nil
}

// SubmitTerms resolves each term to its lemma surface(s) and creates jobs in batch.
func (s *PipelineService) SubmitTerms(ctx context.Context, name string, terms []string, language string, tier int32) ([]*entity.PipelineJob, error) {
	terms = deduplicateTerms(terms)
	if len(terms) == 0 {
		return nil, fmt.Errorf("no valid terms provided")
	}

	if language == "" {
		language = "en"
	}
	if tier == 0 {
		tier = 2
	}

	// Resolve all terms to lemma surfaces, then deduplicate resolved results.
	resolvedSet := make(map[string]struct{}, len(terms))
	resolved := make([]string, 0, len(terms))
	for _, term := range terms {
		lemmas, err := s.resolveTermToLemmas(ctx, term, language)
		if err != nil {
			return nil, fmt.Errorf("resolve %q: %w", term, err)
		}
		for _, lemma := range lemmas {
			key := strings.ToLower(lemma)
			if _, ok := resolvedSet[key]; ok {
				continue
			}
			resolvedSet[key] = struct{}{}
			resolved = append(resolved, lemma)
		}
	}

	pending := make([]*entity.PipelineJob, 0, len(resolved))
	for _, lemma := range resolved {
		jobName := name
		if jobName == "" {
			jobName = fmt.Sprintf("word: %s", lemma)
		}
		pending = append(pending, &entity.PipelineJob{
			Status:   entity.JobStatusPending,
			Name:     jobName,
			Language: language,
			Tier:     tier,
			Term:     lemma,
		})
	}

	const batchSize = 1000
	var allJobs []*entity.PipelineJob
	for i := 0; i < len(pending); i += batchSize {
		end := i + batchSize
		if end > len(pending) {
			end = len(pending)
		}
		created, err := s.jobRepo.BatchCreate(ctx, pending[i:end])
		if err != nil {
			return nil, err
		}
		allJobs = append(allJobs, created...)
	}
	return allJobs, nil
}

// GetJob returns a pipeline job by ID.
func (s *PipelineService) GetJob(ctx context.Context, id int64) (*entity.PipelineJob, error) {
	return s.jobRepo.GetByID(ctx, id)
}

// ListJobs returns pipeline jobs, optionally filtered by status.
func (s *PipelineService) ListJobs(ctx context.Context, status *entity.JobStatus) ([]*entity.PipelineJob, error) {
	return s.jobRepo.List(ctx, status, 50)
}

// ListJobsQuery defines optional filters and pagination for querying jobs.
type ListJobsQuery struct {
	PageNo   int32
	PageSize int32
	Status   *entity.JobStatus
	LemmaID  int64
}

// ListJobsFiltered returns jobs filtered by status/lemma_id with pagination.
func (s *PipelineService) ListJobsFiltered(ctx context.Context, query *ListJobsQuery) ([]*entity.PipelineJob, int64, error) {
	if query == nil {
		query = &ListJobsQuery{}
	}

	pageNo := query.PageNo
	if pageNo <= 0 {
		pageNo = 1
	}
	pageSize := query.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 10000 {
		pageSize = 10000
	}

	return s.jobRepo.ListFiltered(ctx, &repository.ListPipelineJobsQuery{
		Pagination: repository.Pagination{
			PageNo:   pageNo,
			PageSize: pageSize,
		},
		Status:  query.Status,
		LemmaID: query.LemmaID,
	})
}

// GetJobStageProgress computes stage progress for a single-word job.
func (s *PipelineService) GetJobStageProgress(ctx context.Context, job *entity.PipelineJob) (*entity.StageProgressSummary, error) {
	stages, err := s.stageRepo.ListByJob(ctx, job.ID)
	if err != nil {
		return nil, fmt.Errorf("list stages: %w", err)
	}

	return entity.ComputeStageProgress(stages), nil
}

// JobDetail bundles a job with its per-stage detail details.
type JobDetail struct {
	Job    *entity.PipelineJob
	Stages []*entity.PipelineStage // per-stage details (single-word jobs only)
}

// GetJobDetail returns a job along with stage-level details.
func (s *PipelineService) GetJobDetail(ctx context.Context, id int64) (*JobDetail, error) {
	job, err := s.jobRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	detail := &JobDetail{Job: job}

	stages, err := s.stageRepo.ListByJob(ctx, job.ID)
	if err == nil {
		detail.Stages = stages
	}

	return detail, nil
}

// ListJobStages lists all stages for a given job.
func (s *PipelineService) ListJobStages(ctx context.Context, jobID int64) ([]*entity.PipelineStage, error) {
	if jobID == 0 {
		return nil, entity.ErrInvalidInput
	}

	if _, err := s.jobRepo.GetByID(ctx, jobID); err != nil {
		return nil, err
	}

	return s.stageRepo.ListByJob(ctx, jobID)
}

// CancelJob cancels a pending/running/paused job.
func (s *PipelineService) CancelJob(ctx context.Context, id int64) error {
	return s.jobRepo.ChangeStatus(ctx, id, entity.JobActionCancel)
}

// RenewAsNewJob creates a new job from an existing job.
// It does not resume/retry the old job execution.
func (s *PipelineService) RenewAsNewJob(ctx context.Context, id int64) (*entity.PipelineJob, error) {
	oldJob, err := s.jobRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(oldJob.Term) == "" {
		return nil, entity.ErrInvalidInput
	}

	newJob := &entity.PipelineJob{
		Status:   entity.JobStatusPending,
		Name:     oldJob.Name,
		Language: oldJob.Language,
		Tier:     oldJob.Tier,
		Term:     oldJob.Term,
	}
	return s.jobRepo.Create(ctx, newJob)
}

// ControlJob performs a state transition on a job (pause/resume/cancel/retry).
func (s *PipelineService) ControlJob(ctx context.Context, id int64, action entity.JobAction) error {
	return s.jobRepo.ChangeStatus(ctx, id, action)
}

// deduplicateTerms removes duplicates and empty strings from a term list.
func deduplicateTerms(terms []string) []string {
	seen := make(map[string]struct{}, len(terms))
	out := make([]string, 0, len(terms))
	for _, t := range terms {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		lower := strings.ToLower(t)
		if _, ok := seen[lower]; ok {
			continue
		}
		seen[lower] = struct{}{}
		out = append(out, t)
	}
	return out
}

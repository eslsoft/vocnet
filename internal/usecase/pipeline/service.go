package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// PipelineService is the facade for submitting and querying pipeline jobs.
type PipelineService struct {
	jobRepo   repository.PipelineJobRepository
	taskRepo  repository.PipelineTaskRepository
	lemmaRepo repository.LemmaRepository
	logger    *slog.Logger
}

// NewPipelineService creates a new PipelineService.
func NewPipelineService(
	jobRepo repository.PipelineJobRepository,
	taskRepo repository.PipelineTaskRepository,
	lemmaRepo repository.LemmaRepository,
	logger *slog.Logger,
) *PipelineService {
	return &PipelineService{
		jobRepo:   jobRepo,
		taskRepo:  taskRepo,
		lemmaRepo: lemmaRepo,
		logger:    logger,
	}
}

// SubmitWord creates a single-word pipeline job.
func (s *PipelineService) SubmitWord(ctx context.Context, term, language string, tier int32) (*entity.PipelineJob, error) {
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

	job := &entity.PipelineJob{
		Status:     entity.JobStatusPending,
		Name:       fmt.Sprintf("word: %s", term),
		Language:   language,
		Tier:       tier,
		Term:       term,
		TotalTerms: 1,
	}

	return s.jobRepo.Create(ctx, job)
}

// SubmitTerms creates one job per term for bulk execution (e.g. wordbook submit).
func (s *PipelineService) SubmitTerms(ctx context.Context, name string, terms []string, language string, tier int32) ([]*entity.PipelineJob, error) {
	// Deduplicate and trim
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

	jobs := make([]*entity.PipelineJob, 0, len(terms))
	for _, term := range terms {
		jobName := name
		if jobName == "" {
			jobName = fmt.Sprintf("word: %s", term)
		}
		job := &entity.PipelineJob{
			Status:     entity.JobStatusPending,
			Name:       jobName,
			Language:   language,
			Tier:       tier,
			Term:       term,
			TotalTerms: 1,
		}
		created, err := s.jobRepo.Create(ctx, job)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, created)
	}
	return jobs, nil
}

// GetJob returns a pipeline job by ID.
func (s *PipelineService) GetJob(ctx context.Context, id int64) (*entity.PipelineJob, error) {
	return s.jobRepo.GetByID(ctx, id)
}

// ListJobs returns pipeline jobs, optionally filtered by status.
func (s *PipelineService) ListJobs(ctx context.Context, status *entity.JobStatus) ([]*entity.PipelineJob, error) {
	return s.jobRepo.List(ctx, status, 50)
}

// GetJobStageProgress computes stage progress for a job.
func (s *PipelineService) GetJobStageProgress(ctx context.Context, job *entity.PipelineJob) (*entity.StageProgressSummary, error) {
	tasks, err := s.taskRepo.ListByJob(ctx, job.ID)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}

	return entity.ComputeStageProgress(tasks), nil
}

// JobDetail bundles a job with its per-stage task details.
type JobDetail struct {
	Job   *entity.PipelineJob
	Tasks []*entity.PipelineTask // per-stage tasks (single-word jobs only)
}

// GetJobDetail returns a job along with stage-level details.
func (s *PipelineService) GetJobDetail(ctx context.Context, id int64) (*JobDetail, error) {
	job, err := s.jobRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	detail := &JobDetail{Job: job}

	tasks, err := s.taskRepo.ListByJob(ctx, job.ID)
	if err == nil {
		detail.Tasks = tasks
	}

	return detail, nil
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

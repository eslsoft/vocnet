package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
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
	}

	return s.jobRepo.Create(ctx, job)
}

// SubmitJob creates a pipeline job for API calls.
// If name is empty, a default name is generated from term.
func (s *PipelineService) SubmitJob(ctx context.Context, term, language string, tier int32, name string) (*entity.PipelineJob, error) {
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

	jobName := strings.TrimSpace(name)
	if jobName == "" {
		jobName = fmt.Sprintf("word: %s", term)
	}

	job := &entity.PipelineJob{
		JobType:    entity.JobTypeSingleWord,
		Status:     entity.JobStatusPending,
		Name:       jobName,
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

	// Fetch all matching status first; lemma filtering is applied below.
	jobs, err := s.jobRepo.List(ctx, query.Status, 0)
	if err != nil {
		return nil, 0, err
	}

	if query.LemmaID > 0 {
		filtered := make([]*entity.PipelineJob, 0, len(jobs))
		for _, job := range jobs {
			tasks, err := s.taskRepo.ListByJob(ctx, job.ID)
			if err != nil {
				continue
			}
			for _, task := range tasks {
				if task.LemmaID == query.LemmaID {
					filtered = append(filtered, job)
					break
				}
			}
		}
		jobs = filtered
	}

	// Keep stable order: latest first.
	sort.SliceStable(jobs, func(i, j int) bool {
		return jobs[i].CreatedAt.After(jobs[j].CreatedAt)
	})

	total := int64(len(jobs))
	offset := int((pageNo - 1) * pageSize)
	if offset >= len(jobs) {
		return []*entity.PipelineJob{}, total, nil
	}

	end := offset + int(pageSize)
	if end > len(jobs) {
		end = len(jobs)
	}

	return jobs[offset:end], total, nil
}

// GetJobStageProgress computes stage progress for a single-word job.
// Returns nil for wordbook jobs (too expensive for list view).
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

// ListJobStages lists all stages for a given job.
func (s *PipelineService) ListJobStages(ctx context.Context, jobID int64) ([]*entity.PipelineTask, error) {
	if jobID == 0 {
		return nil, entity.ErrInvalidInput
	}

	if _, err := s.jobRepo.GetByID(ctx, jobID); err != nil {
		return nil, err
	}

	return s.taskRepo.ListByJob(ctx, jobID)
}

// ListLemmasQuery defines filters for lemma listing.
type ListLemmasQuery struct {
	PageNo   int32
	PageSize int32
	Keyword  string
}

// ListLemmas lists lemmas for choosing a lemma and then querying related jobs.
func (s *PipelineService) ListLemmas(ctx context.Context, query *ListLemmasQuery) ([]*entity.Lemma, int64, error) {
	if query == nil {
		query = &ListLemmasQuery{}
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

	return s.lemmaRepo.List(ctx, &repository.ListWordsQuery{
		Pagination: repository.Pagination{
			PageNo:   pageNo,
			PageSize: pageSize,
		},
		Keyword: strings.TrimSpace(query.Keyword),
	})
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
		JobType:    oldJob.JobType,
		Status:     entity.JobStatusPending,
		Name:       oldJob.Name,
		Language:   oldJob.Language,
		Tier:       oldJob.Tier,
		Term:       oldJob.Term,
		TotalTerms: 1,
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
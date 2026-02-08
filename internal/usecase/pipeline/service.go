package pipeline

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	"github.com/eslsoft/vocnet/internal/repository"
)

// PipelineService is the facade for submitting and querying pipeline jobs.
type PipelineService struct {
	jobRepo      repository.PipelineJobRepository
	taskRepo     repository.PipelineTaskRepository
	snapshotRepo repository.WordSnapshotRepository
	evidenceRepo repository.EvidenceRepository
	lemmaRepo    repository.LemmaRepository
	dsMgr        *datasource.Manager
	logger       *slog.Logger
}

// NewPipelineService creates a new PipelineService.
func NewPipelineService(
	jobRepo repository.PipelineJobRepository,
	taskRepo repository.PipelineTaskRepository,
	snapshotRepo repository.WordSnapshotRepository,
	evidenceRepo repository.EvidenceRepository,
	lemmaRepo repository.LemmaRepository,
	dsMgr *datasource.Manager,
	logger *slog.Logger,
) *PipelineService {
	return &PipelineService{
		jobRepo:      jobRepo,
		taskRepo:     taskRepo,
		snapshotRepo: snapshotRepo,
		evidenceRepo: evidenceRepo,
		lemmaRepo:    lemmaRepo,
		dsMgr:        dsMgr,
		logger:       logger,
	}
}

// ---------------------------------------------------------------------------
// Job management
// ---------------------------------------------------------------------------

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
		JobType:    entity.JobTypeSingleWord,
		Status:     entity.JobStatusPending,
		Name:       fmt.Sprintf("word: %s", term),
		Language:   language,
		Tier:       tier,
		Term:       term,
		TotalTerms: 1,
	}

	return s.jobRepo.Create(ctx, job)
}

// SubmitTerms creates a wordbook pipeline job from a list of terms.
func (s *PipelineService) SubmitTerms(ctx context.Context, name string, terms []string, language string, tier int32) (*entity.PipelineJob, error) {
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

	if name == "" {
		name = fmt.Sprintf("wordbook: %d terms (%s)", len(terms), time.Now().Format("2006-01-02 15:04"))
	}

	job := &entity.PipelineJob{
		JobType:    entity.JobTypeWordbook,
		Status:     entity.JobStatusPending,
		Name:       name,
		Language:   language,
		Tier:       tier,
		Terms:      terms,
		TotalTerms: int32(len(terms)),
	}

	return s.jobRepo.Create(ctx, job)
}

// GetJob returns a pipeline job by ID.
func (s *PipelineService) GetJob(ctx context.Context, id int64) (*entity.PipelineJob, error) {
	return s.jobRepo.GetByID(ctx, id)
}

// ListJobs returns pipeline jobs, optionally filtered by status.
func (s *PipelineService) ListJobs(ctx context.Context, status *entity.JobStatus, limit int) ([]*entity.PipelineJob, error) {
	if limit <= 0 {
		limit = 50
	}
	return s.jobRepo.List(ctx, status, limit)
}

// CancelJob cancels a pending or running pipeline job.
func (s *PipelineService) CancelJob(ctx context.Context, id int64) (*entity.PipelineJob, error) {
	job, err := s.jobRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if job.Status != entity.JobStatusPending && job.Status != entity.JobStatusRunning {
		return nil, entity.ErrJobNotCancellable
	}

	if err := s.jobRepo.UpdateStatus(ctx, id, entity.JobStatusCancelled, "cancelled by user"); err != nil {
		return nil, err
	}

	return s.jobRepo.GetByID(ctx, id)
}

// ---------------------------------------------------------------------------
// Pipeline status & results
// ---------------------------------------------------------------------------

// GetPipelineStatus returns the task statuses for a word's pipeline.
func (s *PipelineService) GetPipelineStatus(ctx context.Context, term, language string) (*entity.Lemma, []*entity.PipelineTask, error) {
	if language == "" {
		language = "en"
	}

	lemma, err := s.lemmaRepo.LookupByForm(ctx, term, entity.Language(language))
	if err != nil {
		if errors.Is(err, entity.ErrLemmaNotFound) {
			return nil, nil, entity.ErrLemmaNotFound
		}
		return nil, nil, fmt.Errorf("lookup lemma: %w", err)
	}

	tasks, err := s.taskRepo.ListByLemma(ctx, lemma.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("list tasks: %w", err)
	}

	return lemma, tasks, nil
}

// GetWordSnapshot returns the materialized snapshot for a word.
func (s *PipelineService) GetWordSnapshot(ctx context.Context, term, language string) (*entity.WordSnapshot, error) {
	if language == "" {
		language = "en"
	}

	snapshot, err := s.snapshotRepo.GetByTerm(ctx, term, language)
	if err != nil {
		if errors.Is(err, entity.ErrWordNotFound) {
			return nil, entity.ErrSnapshotNotFound
		}
		return nil, fmt.Errorf("get snapshot: %w", err)
	}
	return snapshot, nil
}

// ListWordSnapshots returns a paginated list of snapshots.
func (s *PipelineService) ListWordSnapshots(ctx context.Context, query *repository.ListSnapshotsQuery) ([]*entity.WordSnapshot, int, error) {
	return s.snapshotRepo.List(ctx, query)
}

// GetEvidence returns raw evidence for a word, optionally filtered by phase and provider.
func (s *PipelineService) GetEvidence(ctx context.Context, term, language string, phase int32, provider string) ([]*entity.RawEvidence, error) {
	if language == "" {
		language = "en"
	}

	lemma, err := s.lemmaRepo.LookupByForm(ctx, term, entity.Language(language))
	if err != nil {
		if errors.Is(err, entity.ErrLemmaNotFound) {
			return nil, entity.ErrLemmaNotFound
		}
		return nil, fmt.Errorf("lookup lemma: %w", err)
	}

	var evidences []*entity.RawEvidence
	if phase > 0 {
		evidences, err = s.evidenceRepo.FindByLemmaAndPhase(ctx, lemma.ID, phase)
	} else {
		evidences, err = s.evidenceRepo.FindByLemma(ctx, lemma.ID)
	}
	if err != nil {
		return nil, fmt.Errorf("find evidence: %w", err)
	}

	// Filter by provider if specified
	if provider != "" {
		filtered := make([]*entity.RawEvidence, 0, len(evidences))
		for _, e := range evidences {
			if e.Provider == provider {
				filtered = append(filtered, e)
			}
		}
		evidences = filtered
	}

	return evidences, nil
}

// ---------------------------------------------------------------------------
// Data source management
// ---------------------------------------------------------------------------

// ListDataSources returns the status of all pipeline data sources.
func (s *PipelineService) ListDataSources(ctx context.Context) ([]datasource.Status, error) {
	if s.dsMgr == nil {
		return nil, fmt.Errorf("data source manager not configured")
	}
	return s.dsMgr.CheckAll()
}

// DownloadDataSource downloads a specific or all missing data sources.
func (s *PipelineService) DownloadDataSource(ctx context.Context, name string) ([]datasource.Status, error) {
	if s.dsMgr == nil {
		return nil, fmt.Errorf("data source manager not configured")
	}

	if name == "" {
		if err := s.dsMgr.DownloadMissing(ctx); err != nil {
			return nil, err
		}
	} else {
		if err := s.dsMgr.DownloadSource(ctx, name); err != nil {
			return nil, err
		}
	}

	return s.dsMgr.CheckAll()
}

// ---------------------------------------------------------------------------
// Job detail & stage progress
// ---------------------------------------------------------------------------

// GetJobStageProgress computes stage progress for a single-word job.
// Returns nil for wordbook jobs (too expensive for list view).
func (s *PipelineService) GetJobStageProgress(ctx context.Context, job *entity.PipelineJob) (*entity.StageProgressSummary, error) {
	if job.JobType != entity.JobTypeSingleWord || job.Term == "" {
		return nil, nil
	}

	lemma, err := s.lemmaRepo.LookupByForm(ctx, job.Term, entity.ParseLanguage(job.Language))
	if err != nil {
		return nil, nil // lemma not found yet — job hasn't started
	}

	tasks, err := s.taskRepo.ListByLemma(ctx, lemma.ID)
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

// GetJobDetail returns a job along with stage-level details (for single-word jobs).
func (s *PipelineService) GetJobDetail(ctx context.Context, id int64) (*JobDetail, error) {
	job, err := s.jobRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	detail := &JobDetail{Job: job}

	if job.JobType == entity.JobTypeSingleWord && job.Term != "" {
		lemma, err := s.lemmaRepo.LookupByForm(ctx, job.Term, entity.ParseLanguage(job.Language))
		if err == nil {
			tasks, err := s.taskRepo.ListByLemma(ctx, lemma.ID)
			if err == nil {
				detail.Tasks = tasks
			}
		}
	}

	return detail, nil
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

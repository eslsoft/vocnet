package pipeline

import (
	"context"
	"log/slog"
	"time"

	"golang.org/x/time/rate"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Worker is a background consumer that processes pipeline jobs.
type Worker struct {
	jobRepo      repository.PipelineJobRepository
	snapshotRepo repository.WordSnapshotRepository
	pipeline     *Pipeline
	logger       *slog.Logger

	pollInterval time.Duration
	rateLimiter  *rate.Limiter

	cancel context.CancelFunc
}

// NewWorker creates a new pipeline Worker.
func NewWorker(
	jobRepo repository.PipelineJobRepository,
	snapshotRepo repository.WordSnapshotRepository,
	pipeline *Pipeline,
	logger *slog.Logger,
) *Worker {
	return &Worker{
		jobRepo:      jobRepo,
		snapshotRepo: snapshotRepo,
		pipeline:     pipeline,
		logger:       logger.With("component", "pipeline-worker"),
		pollInterval: 5 * time.Second,
		rateLimiter:  rate.NewLimiter(rate.Limit(2.0), 1), // 2 req/s for Wikidata
	}
}

// Start begins the background job processing loop.
// It blocks until the context is cancelled or Stop is called.
func (w *Worker) Start(ctx context.Context) error {
	ctx, w.cancel = context.WithCancel(ctx)
	w.logger.Info("pipeline worker started", "poll_interval", w.pollInterval)

	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			w.logger.Info("pipeline worker stopped")
			return nil
		case <-ticker.C:
			w.pollOnce(ctx)
		}
	}
}

// Stop gracefully stops the worker.
func (w *Worker) Stop() {
	if w.cancel != nil {
		w.cancel()
	}
}

func (w *Worker) pollOnce(ctx context.Context) {
	job, err := w.jobRepo.ClaimNext(ctx)
	if err != nil {
		w.logger.Error("failed to claim job", "error", err)
		return
	}
	if job == nil {
		return // No pending jobs
	}

	w.logger.Info("processing job", "job_id", job.ID, "name", job.Name, "type", job.JobType)
	w.processJob(ctx, job)
}

func (w *Worker) processJob(ctx context.Context, job *entity.PipelineJob) {
	// Build terms list
	var terms []string
	switch job.JobType {
	case entity.JobTypeSingleWord:
		terms = []string{job.Term}
	case entity.JobTypeWordbook:
		terms = job.Terms
	}

	for _, term := range terms {
		// Check context cancellation
		select {
		case <-ctx.Done():
			w.logger.Warn("job interrupted by shutdown", "job_id", job.ID)
			// Mark back as PENDING so it can be resumed
			_ = w.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusPending, "")
			return
		default:
		}

		// Rate limit for Wikidata API
		if err := w.rateLimiter.Wait(ctx); err != nil {
			w.logger.Warn("rate limiter interrupted", "job_id", job.ID, "error", err)
			_ = w.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusPending, "")
			return
		}

		// Check if snapshot already exists → skip.
		// On resume, previously processed terms hit this path and increment
		// Skipped instead of Processed, so counters may not sum perfectly
		// after a restart. The behavior is correct — no work is duplicated.
		_, err := w.snapshotRepo.GetByTerm(ctx, term, job.Language)
		if err == nil {
			_ = w.jobRepo.IncrementSkipped(ctx, job.ID)
			w.logger.Debug("skipped (snapshot exists)", "term", term, "job_id", job.ID)
			continue
		}

		// Process the word
		_, err = w.pipeline.Run(ctx, term, job.Language, job.Tier)
		if err != nil {
			_ = w.jobRepo.IncrementFailed(ctx, job.ID)
			w.logger.Warn("failed to process term", "term", term, "job_id", job.ID, "error", err)
			continue
		}

		_ = w.jobRepo.IncrementProcessed(ctx, job.ID)
		w.logger.Debug("processed", "term", term, "job_id", job.ID)
	}

	// All done
	_ = w.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusCompleted, "")
	w.logger.Info("job completed", "job_id", job.ID, "name", job.Name)
}

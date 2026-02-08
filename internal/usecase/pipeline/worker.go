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

	jobLogger := w.logger.With("job_id", job.ID)
	jobLogger.Info("processing job", "name", job.Name, "type", job.JobType, "total_terms", len(w.buildTerms(job)))
	w.processJob(ctx, job, jobLogger)
}

// buildTerms extracts the term list from a job.
func (w *Worker) buildTerms(job *entity.PipelineJob) []string {
	switch job.JobType {
	case entity.JobTypeSingleWord:
		return []string{job.Term}
	case entity.JobTypeWordbook:
		return job.Terms
	default:
		return nil
	}
}

func (w *Worker) processJob(ctx context.Context, job *entity.PipelineJob, jobLogger *slog.Logger) {
	jobStart := time.Now()
	terms := w.buildTerms(job)

	var processed, skipped, failed int
	for _, term := range terms {
		// Check context cancellation
		select {
		case <-ctx.Done():
			jobLogger.Warn("job interrupted by shutdown")
			// Mark back as PENDING so it can be resumed
			_ = w.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusPending, "")
			return
		default:
		}

		// Rate limit for Wikidata API
		if err := w.rateLimiter.Wait(ctx); err != nil {
			jobLogger.Warn("rate limiter interrupted", "error", err)
			_ = w.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusPending, "")
			return
		}

		termLogger := jobLogger.With("term", term)

		// Check if snapshot already exists → skip.
		// On resume, previously processed terms hit this path and increment
		// Skipped instead of Processed, so counters may not sum perfectly
		// after a restart. The behavior is correct — no work is duplicated.
		_, err := w.snapshotRepo.GetByTerm(ctx, term, job.Language)
		if err == nil {
			_ = w.jobRepo.IncrementSkipped(ctx, job.ID)
			skipped++
			termLogger.Debug("skipped (snapshot exists)")
			continue
		}

		// Process the word
		termStart := time.Now()
		_, err = w.pipeline.Run(ctx, term, job.Language, job.Tier, &RunOptions{Logger: termLogger})
		if err != nil {
			_ = w.jobRepo.IncrementFailed(ctx, job.ID)
			failed++
			termLogger.Warn("failed to process term", "error", err)
			continue
		}

		_ = w.jobRepo.IncrementProcessed(ctx, job.ID)
		processed++
		termLogger.Debug("term processed", "duration", time.Since(termStart))
	}

	// All done
	_ = w.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusCompleted, "")
	jobLogger.Info("job completed", "duration", time.Since(jobStart), "processed", processed, "skipped", skipped, "failed", failed)
}

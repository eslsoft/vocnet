package pipeline

import (
	"context"
	"log/slog"
	"time"

	"github.com/gammazero/workerpool"
	"golang.org/x/time/rate"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// WorkerPoolConfig configures the worker pool.
type WorkerPoolConfig struct {
	WorkerCount  int           // Number of concurrent workers (default: 1)
	PollInterval time.Duration // Interval between job polls (default: 5s)
	RateLimit    float64       // Rate limit per second for API calls (default: 2.0)
}

// WorkerPool manages concurrent pipeline job processing using gammazero/workerpool.
type WorkerPool struct {
	jobRepo  repository.PipelineJobRepository
	pipeline *Pipeline
	logger   *slog.Logger
	config   WorkerPoolConfig

	pool        *workerpool.WorkerPool
	rateLimiter *rate.Limiter
	cancel      context.CancelFunc
}

// NewWorkerPool creates a new worker pool with the given configuration.
func NewWorkerPool(
	jobRepo repository.PipelineJobRepository,
	pipeline *Pipeline,
	logger *slog.Logger,
	config WorkerPoolConfig,
) *WorkerPool {
	if config.WorkerCount <= 0 {
		config.WorkerCount = 1
	}
	if config.PollInterval <= 0 {
		config.PollInterval = 5 * time.Second
	}
	if config.RateLimit <= 0 {
		config.RateLimit = 2.0
	}

	return &WorkerPool{
		jobRepo:     jobRepo,
		pipeline:    pipeline,
		logger:      logger.With("component", "pipeline-worker-pool"),
		config:      config,
		rateLimiter: rate.NewLimiter(rate.Limit(config.RateLimit), 1),
	}
}

// Start begins the worker pool and polls for jobs.
// It blocks until the context is cancelled or Stop is called.
func (p *WorkerPool) Start(ctx context.Context) error {
	ctx, p.cancel = context.WithCancel(ctx)
	p.pool = workerpool.New(p.config.WorkerCount)

	p.logger.Info("pipeline worker pool started",
		"worker_count", p.config.WorkerCount,
		"poll_interval", p.config.PollInterval,
		"rate_limit", p.config.RateLimit,
	)

	ticker := time.NewTicker(p.config.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			p.pool.StopWait()
			p.logger.Info("pipeline worker pool stopped")
			return nil
		case <-ticker.C:
			p.pollAndSubmit(ctx)
		}
	}
}

// Stop gracefully stops all workers.
func (p *WorkerPool) Stop() {
	if p.cancel != nil {
		p.cancel()
	}
}

func (p *WorkerPool) pollAndSubmit(ctx context.Context) {
	job, err := p.jobRepo.ClaimNext(ctx)
	if err != nil {
		p.logger.Error("failed to claim job", "error", err)
		return
	}
	if job == nil {
		return // No pending jobs
	}

	jobLogger := p.logger.With("job_id", job.ID)
	jobLogger.Info("submitting job to pool", "name", job.Name, "type", job.JobType)

	// Submit job to worker pool
	p.pool.Submit(func() {
		p.processJob(ctx, job, jobLogger)
	})
}

func (p *WorkerPool) processJob(ctx context.Context, job *entity.PipelineJob, jobLogger *slog.Logger) {
	jobStart := time.Now()
	term := job.Term
	if term == "" && len(job.Terms) > 0 {
		term = job.Terms[0]
	}
	if term == "" {
		_ = p.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusFailed, "empty term")
		jobLogger.Warn("job has no term, marked failed")
		return
	}

	// Check context cancellation (server shutdown)
	select {
	case <-ctx.Done():
		jobLogger.Warn("job interrupted by shutdown")
		// Mark back as PENDING so it can be resumed
		_ = p.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusPending, "")
		return
	default:
	}

	// Check if job was paused or cancelled by user
	currentJob, err := p.jobRepo.GetByID(ctx, job.ID)
	if err != nil {
		jobLogger.Error("failed to check job status", "error", err)
		return
	}

	switch currentJob.Status {
	case entity.JobStatusPaused:
		jobLogger.Info("job paused by user")
		return
	case entity.JobStatusCancelled:
		jobLogger.Info("job cancelled by user")
		return
	}

	// Rate limit for API calls
	if err := p.rateLimiter.Wait(ctx); err != nil {
		jobLogger.Warn("rate limiter interrupted", "error", err)
		_ = p.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusPending, "")
		return
	}

	termLogger := jobLogger.With("term", term)
	termStart := time.Now()
	_, err = p.pipeline.Run(ctx, job.ID, term, job.Language, job.Tier, &RunOptions{Logger: termLogger})
	if err != nil {
		_ = p.jobRepo.IncrementFailed(ctx, job.ID)
		_ = p.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusFailed, err.Error())
		termLogger.Warn("failed to process term", "error", err)
		return
	}

	_ = p.jobRepo.IncrementProcessed(ctx, job.ID)
	_ = p.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusCompleted, "")
	jobLogger.Info("job completed", "duration", time.Since(jobStart), "processed", 1, "failed", 0, "term_duration", time.Since(termStart))
}

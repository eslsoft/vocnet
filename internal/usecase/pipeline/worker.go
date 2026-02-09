package pipeline

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/gammazero/workerpool"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// WorkerPoolConfig configures the worker pool.
type WorkerPoolConfig struct {
	WorkerCount         int                   // Number of concurrent workers (default: 1)
	PollInterval        time.Duration         // Interval between job polls (default: 5s)
	ProgressLogInterval time.Duration         // Interval between progress logs (default: 30s, 0 to disable)
	MetricsRegisterer   prometheus.Registerer // Metrics registry (default: prometheus.DefaultRegisterer)
}

// WorkerPool manages concurrent pipeline job processing using gammazero/workerpool.
type WorkerPool struct {
	jobRepo  repository.PipelineJobRepository
	pipeline *Pipeline
	logger   *slog.Logger
	config   WorkerPoolConfig

	pool    *workerpool.WorkerPool
	cancel  context.CancelFunc
	done    chan struct{} // signals when Start() has fully completed
	metrics *WorkerPoolMetrics

	// inFlight tracks claimed jobs that are either running or queued inside the workerpool.
	inFlight atomic.Int64

	processFn func(context.Context, *entity.PipelineJob, *slog.Logger)
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
	if config.ProgressLogInterval == 0 {
		config.ProgressLogInterval = 30 * time.Second
	}
	if config.MetricsRegisterer == nil {
		config.MetricsRegisterer = prometheus.DefaultRegisterer
	}

	wp := &WorkerPool{
		jobRepo:  jobRepo,
		pipeline: pipeline,
		logger:   logger.With("component", "pipeline-worker-pool"),
		config:   config,
		done:     make(chan struct{}),
		metrics:  NewWorkerPoolMetricsWithRegistry(config.MetricsRegisterer),
	}
	wp.processFn = wp.processJob
	return wp
}

// Start begins the worker pool and polls for jobs.
// It blocks until the context is cancelled or Stop is called.
func (p *WorkerPool) Start(ctx context.Context) error {
	defer close(p.done) // signal completion when Start exits

	ctx, p.cancel = context.WithCancel(ctx)
	p.pool = workerpool.New(p.config.WorkerCount)

	p.logger.Info("pipeline worker pool started",
		"worker_count", p.config.WorkerCount,
		"poll_interval", p.config.PollInterval.String(),
	)

	pollTicker := time.NewTicker(p.config.PollInterval)
	defer pollTicker.Stop()

	// Progress logging ticker (nil if disabled)
	var progressTicker *time.Ticker
	var progressCh <-chan time.Time
	if p.config.ProgressLogInterval > 0 {
		progressTicker = time.NewTicker(p.config.ProgressLogInterval)
		progressCh = progressTicker.C
		defer progressTicker.Stop()
	}

	for {
		select {
		case <-ctx.Done():
			p.logger.Info("pipeline worker pool stopping, waiting for in-flight jobs...")
			p.pool.StopWait()
			p.logProgress() // Final progress report
			p.logger.Info("pipeline worker pool stopped")
			return nil
		case <-pollTicker.C:
			p.pollAndSubmit(ctx)
		case <-progressCh:
			p.logProgress()
		}
	}
}

// Stop gracefully stops all workers and waits for completion.
func (p *WorkerPool) Stop() {
	if p.cancel != nil {
		p.cancel()
	}
}

// Wait blocks until the worker pool has fully stopped.
// Should be called after Stop() to ensure graceful shutdown.
func (p *WorkerPool) Wait() {
	<-p.done
}

// Metrics returns the current metrics snapshot.
func (p *WorkerPool) Metrics() MetricsSnapshot {
	return p.metrics.Snapshot()
}

// GetMetrics returns the underlying metrics collector (for external access).
func (p *WorkerPool) GetMetrics() *WorkerPoolMetrics {
	return p.metrics
}

// logProgress logs the current progress metrics.
func (p *WorkerPool) logProgress() {
	m := p.metrics.Snapshot()
	if m.JobsProcessed == 0 {
		return // Nothing to report
	}

	p.logger.Info("pipeline progress",
		"processed", m.JobsProcessed,
		"succeeded", m.JobsSucceeded,
		"failed", m.JobsFailed,
		"pending", m.PendingJobs,
		"rate_per_min", m.JobsPerMinute,
		"recent_rate_per_min", m.RecentJobsPerMinute,
		"avg_duration_ms", m.AvgDurationMs,
		"uptime_s", m.UptimeSeconds,
	)
}

func (p *WorkerPool) pollAndSubmit(ctx context.Context) {
	// Update pending jobs count
	count, err := p.jobRepo.CountByStatus(ctx, entity.JobStatusPending)
	if err != nil {
		p.logger.Error("failed to count pending jobs", "error", err)
	} else {
		p.metrics.SetPendingJobs(int64(count))
	}
	p.metrics.SetInFlightJobs(p.inFlight.Load(), p.config.WorkerCount)

	availableSlots := p.config.WorkerCount - int(p.inFlight.Load())
	if availableSlots <= 0 {
		return
	}

	// Claim only enough jobs to fill currently available worker slots.
	for range availableSlots {
		job, err := p.jobRepo.ClaimNext(ctx)
		if err != nil {
			p.logger.Error("failed to claim job", "error", err)
			return
		}
		if job == nil {
			return // No more pending jobs
		}

		jobLogger := p.logger.With("job_id", job.ID)
		jobLogger.Info("submitting job to pool", "name", job.Name, "type", job.JobType)

		// Submit job to worker pool - capture loop variables
		p.inFlight.Add(1)
		p.metrics.SetInFlightJobs(p.inFlight.Load(), p.config.WorkerCount)
		j, jl := job, jobLogger
		p.pool.Submit(func() {
			defer func() {
				p.inFlight.Add(-1)
				p.metrics.SetInFlightJobs(p.inFlight.Load(), p.config.WorkerCount)
			}()
			p.processFn(ctx, j, jl)
		})
	}
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

	termLogger := jobLogger.With("term", term)
	termStart := time.Now()
	_, err = p.pipeline.Run(ctx, job.ID, term, job.Language, job.Tier, &RunOptions{Logger: termLogger})
	duration := time.Since(termStart)
	if err != nil {
		p.metrics.RecordJob(duration, false)
		_ = p.jobRepo.IncrementFailed(ctx, job.ID)
		_ = p.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusFailed, err.Error())
		termLogger.Warn("failed to process term", "error", err)
		return
	}

	p.metrics.RecordJob(duration, true)
	_ = p.jobRepo.IncrementProcessed(ctx, job.ID)
	_ = p.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusCompleted, "")
	jobLogger.Info("job completed", "duration", time.Since(jobStart).String(), "processed", 1, "failed", 0, "term_duration", duration.String())
}

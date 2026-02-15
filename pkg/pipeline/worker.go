package pipeline

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gammazero/workerpool"
)

// WorkerPoolConfig configures the worker pool.
type WorkerPoolConfig struct {
	WorkerCount         int           // Number of concurrent workers (default: 1)
	PollInterval        time.Duration // Interval between job polls (default: 5s)
	ProgressLogInterval time.Duration // Interval between progress logs (default: 30s, 0 to disable)
}

// Job represents a unit of work.
type Job interface {
	ID() any
}

// WorkerPool manages concurrent job processing.
type WorkerPool[J Job] struct {
	config    WorkerPoolConfig
	logger    *slog.Logger
	metrics   Metrics

	mu        sync.Mutex
	pool      *workerpool.WorkerPool
	cancel    context.CancelFunc
	done      chan struct{}

	inFlight  atomic.Int64
	wakeCh    chan struct{}

	fetchFn   func(context.Context, int) ([]J, int64, error) // batchSize -> (jobs, pendingCount, error)
	processFn func(context.Context, J) error
}

// NewWorkerPool creates a new production-ready worker pool.
func NewWorkerPool[J Job](
	config WorkerPoolConfig,
	fetchFn func(context.Context, int) ([]J, int64, error),
	processFn func(context.Context, J) error,
	metrics Metrics,
	logger *slog.Logger,
) *WorkerPool[J] {
	if config.WorkerCount <= 0 {
		config.WorkerCount = 1
	}
	if config.PollInterval <= 0 {
		config.PollInterval = 5 * time.Second
	}
	if metrics == nil {
		metrics = NoopMetrics{}
	}
	if logger == nil {
		logger = slog.Default()
	}

	return &WorkerPool[J]{
		config:    config,
		fetchFn:   fetchFn,
		processFn: processFn,
		metrics:   metrics,
		logger:    logger.With("component", "worker-pool"),
		done:      make(chan struct{}),
		wakeCh:    make(chan struct{}, 1),
	}
}

// Start begins the worker pool and polls for jobs.
func (p *WorkerPool[J]) Start(ctx context.Context) error {
	defer close(p.done)

	p.mu.Lock()
	ctx, p.cancel = context.WithCancel(ctx)
	p.pool = workerpool.New(p.config.WorkerCount)
	p.mu.Unlock()

	p.logger.Info("worker pool started",
		"workers", p.config.WorkerCount,
		"poll_interval", p.config.PollInterval.String(),
	)

	pollTicker := time.NewTicker(p.config.PollInterval)
	defer pollTicker.Stop()
	p.pollAndSubmit(ctx)

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
			p.logger.Info("worker pool stopping...")
			p.mu.Lock()
			if p.pool != nil {
				p.pool.StopWait()
			}
			p.mu.Unlock()
			return nil
		case <-pollTicker.C:
			p.pollAndSubmit(ctx)
		case <-p.wakeCh:
			p.pollAndSubmit(ctx)
		case <-progressCh:
			p.logProgress()
		}
	}
}

// Stop initiates a graceful shutdown.
func (p *WorkerPool[J]) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cancel != nil {
		p.cancel()
	}
}

// Wait blocks until the pool has fully stopped.
func (p *WorkerPool[J]) Wait() {
	<-p.done
}

func (p *WorkerPool[J]) pollAndSubmit(ctx context.Context) {
	p.mu.Lock()
	if p.pool == nil {
		p.mu.Unlock()
		return
	}
	pool := p.pool
	p.mu.Unlock()

	availableSlots := p.config.WorkerCount - int(p.inFlight.Load())
	p.metrics.SetInFlightJobs(p.inFlight.Load(), p.config.WorkerCount)

	if availableSlots <= 0 {
		return
	}

	jobs, pending, err := p.fetchFn(ctx, availableSlots)
	if err != nil {
		p.logger.Error("failed to fetch jobs", "error", err)
		return
	}

	p.metrics.SetPendingJobs(pending)

	for _, job := range jobs {
		p.inFlight.Add(1)
		p.metrics.SetInFlightJobs(p.inFlight.Load(), p.config.WorkerCount)

		j := job
		pool.Submit(func() {
			defer func() {
				p.inFlight.Add(-1)
				p.metrics.SetInFlightJobs(p.inFlight.Load(), p.config.WorkerCount)
				p.signalWake()
			}()

			start := time.Now()
			err := p.processFn(ctx, j)
			p.metrics.RecordJob(time.Since(start), err == nil)

			if err != nil {
				p.logger.Error("job failed", "job_id", j.ID(), "error", err)
			}
		})
	}
}

func (p *WorkerPool[J]) signalWake() {
	select {
	case p.wakeCh <- struct{}{}:
	default:
	}
}

func (p *WorkerPool[J]) logProgress() {
	p.logger.Debug("worker pool progress",
		"in_flight", p.inFlight.Load(),
	)
}

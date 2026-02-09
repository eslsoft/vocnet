package pipeline

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gammazero/workerpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"

	"github.com/eslsoft/vocnet/internal/entity"
)

type claimOnlyJobRepo struct {
	mu      sync.Mutex
	pending []*entity.PipelineJob
	claimed int
}

func (r *claimOnlyJobRepo) Create(context.Context, *entity.PipelineJob) (*entity.PipelineJob, error) {
	panic("not implemented")
}

func (r *claimOnlyJobRepo) GetByID(context.Context, int64) (*entity.PipelineJob, error) {
	panic("not implemented")
}

func (r *claimOnlyJobRepo) List(context.Context, *entity.JobStatus, int) ([]*entity.PipelineJob, error) {
	panic("not implemented")
}

func (r *claimOnlyJobRepo) ClaimNextBatch(ctx context.Context, limit int) ([]*entity.PipelineJob, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.pending) == 0 || limit <= 0 {
		return nil, nil
	}
	if limit > len(r.pending) {
		limit = len(r.pending)
	}
	out := make([]*entity.PipelineJob, 0, limit)
	for range limit {
		job := r.pending[0]
		r.pending = r.pending[1:]
		r.claimed++
		out = append(out, job)
	}
	return out, nil
}

func (r *claimOnlyJobRepo) IncrementProcessed(context.Context, int64) error {
	return nil
}

func (r *claimOnlyJobRepo) IncrementSkipped(context.Context, int64) error {
	return nil
}

func (r *claimOnlyJobRepo) IncrementFailed(context.Context, int64) error {
	return nil
}

func (r *claimOnlyJobRepo) UpdateStatus(context.Context, int64, entity.JobStatus, string) error {
	return nil
}

func (r *claimOnlyJobRepo) CountByStatus(context.Context, entity.JobStatus) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pending), nil
}

func (r *claimOnlyJobRepo) ChangeStatus(context.Context, int64, entity.JobAction) error {
	panic("not implemented")
}

func TestWorkerPoolPollAndSubmit_ClaimBoundedByAvailableSlots(t *testing.T) {
	repo := &claimOnlyJobRepo{
		pending: []*entity.PipelineJob{
			{ID: 1, Term: "one"},
			{ID: 2, Term: "two"},
			{ID: 3, Term: "three"},
			{ID: 4, Term: "four"},
			{ID: 5, Term: "five"},
		},
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	pool := NewWorkerPool(repo, nil, logger, WorkerPoolConfig{
		WorkerCount:       2,
		MetricsRegisterer: prometheus.NewRegistry(),
	})
	pool.pool = workerpool.New(2)
	defer pool.pool.StopWait()

	blockCh := make(chan struct{})
	var started atomic.Int64
	pool.processFn = func(_ context.Context, _ *entity.PipelineJob, _ *slog.Logger) {
		started.Add(1)
		<-blockCh
	}

	ctx := context.Background()
	pool.pollAndSubmit(ctx)

	require.Eventually(t, func() bool {
		return started.Load() == 2
	}, time.Second, 10*time.Millisecond)
	require.Equal(t, 2, repo.claimed)

	// Polling again while both slots are occupied should not claim more.
	pool.pollAndSubmit(ctx)
	require.Equal(t, 2, repo.claimed)

	// Unblock current jobs and allow next polling cycle to claim more.
	close(blockCh)
	require.Eventually(t, func() bool {
		return pool.inFlight.Load() == 0
	}, time.Second, 10*time.Millisecond)

	nextBlock := make(chan struct{})
	pool.processFn = func(_ context.Context, _ *entity.PipelineJob, _ *slog.Logger) {
		<-nextBlock
	}
	pool.pollAndSubmit(ctx)
	require.Equal(t, 4, repo.claimed)
	close(nextBlock)
}

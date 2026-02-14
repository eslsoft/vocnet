package pipeline

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

type mockJob struct {
	id int
}

func (j mockJob) ID() any { return j.id }

func TestWorkerPool_StartStop(t *testing.T) {
	var processedCount atomic.Int64
	var mu sync.Mutex
	fetchedTotal := 0

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	fetchFn := func(ctx context.Context, batchSize int) ([]mockJob, int64, error) {
		mu.Lock()
		defer mu.Unlock()

		if fetchedTotal >= 5 {
			return nil, 0, nil
		}

		numToFetch := batchSize
		if numToFetch > 5-fetchedTotal {
			numToFetch = 5 - fetchedTotal
		}

		jobs := make([]mockJob, numToFetch)
		for i := 0; i < numToFetch; i++ {
			jobs[i] = mockJob{id: fetchedTotal + i}
		}
		fetchedTotal += numToFetch
		return jobs, int64(5 - fetchedTotal), nil
	}

	processFn := func(ctx context.Context, job mockJob) error {
		processedCount.Add(1)
		return nil
	}

	wp := NewWorkerPool(
		WorkerPoolConfig{
			WorkerCount:  2,
			PollInterval: 10 * time.Millisecond,
		},
		fetchFn,
		processFn,
		nil,
		nil,
	)

	doneCh := make(chan error, 1)
	go func() {
		doneCh <- wp.Start(ctx)
	}()

	// Wait for processedCount to reach 5 or timeout
	start := time.Now()
	for processedCount.Load() < 5 && time.Since(start) < 1*time.Second {
		time.Sleep(10 * time.Millisecond)
	}

	wp.Stop()
	err := <-doneCh
	assert.NoError(t, err)
	wp.Wait()

	assert.Equal(t, int64(5), processedCount.Load())
}

func TestWorkerPool_ErrorHandling(t *testing.T) {
	var fetchCount atomic.Int64
	fetchFn := func(ctx context.Context, batchSize int) ([]mockJob, int64, error) {
		if fetchCount.Add(1) > 3 {
			return nil, 0, nil
		}
		return []mockJob{{id: 1}}, 1, nil
	}

	processFn := func(ctx context.Context, job mockJob) error {
		return errors.New("expected error")
	}

	wp := NewWorkerPool(
		WorkerPoolConfig{
			WorkerCount:  1,
			PollInterval: 10 * time.Millisecond,
		},
		fetchFn,
		processFn,
		nil,
		nil,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	doneCh := make(chan error, 1)
	go func() {
		doneCh <- wp.Start(ctx)
	}()

	time.Sleep(50 * time.Millisecond)
	wp.Stop()
	<-doneCh
	wp.Wait()
}

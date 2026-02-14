package engine

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

func TestWorkerPoolStop(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	pool := NewWorkerPool(nil, nil, logger, WorkerPoolConfig{
		WorkerCount:       1,
		PollInterval:      time.Second,
		MetricsRegisterer: prometheus.NewRegistry(),
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	go func() {
		_ = pool.Start(ctx)
		close(done)
	}()

	// Give worker pool a moment to start
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-done:
		// Worker pool stopped successfully
	case <-time.After(2 * time.Second):
		t.Fatal("worker pool did not stop within timeout")
	}
}

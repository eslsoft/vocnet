package pipeline

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestDeduplicateTerms(t *testing.T) {
	tests := []struct {
		name     string
		input    []string
		expected []string
	}{
		{
			name:     "no duplicates",
			input:    []string{"hello", "world"},
			expected: []string{"hello", "world"},
		},
		{
			name:     "case-insensitive dedup",
			input:    []string{"Hello", "hello", "HELLO"},
			expected: []string{"Hello"},
		},
		{
			name:     "trims whitespace",
			input:    []string{"  hello  ", "world", "  "},
			expected: []string{"hello", "world"},
		},
		{
			name:     "empty input",
			input:    []string{},
			expected: []string{},
		},
		{
			name:     "all empty strings",
			input:    []string{"", "  ", ""},
			expected: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := deduplicateTerms(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestWorkerPoolStop(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	pool := NewWorkerPool(nil, nil, logger, WorkerPoolConfig{
		WorkerCount:  1,
		PollInterval: time.Second,
		RateLimit:    2.0,
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

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

func TestWorkerStop(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	pool := NewWorkerPool(nil, nil, nil, logger, WorkerPoolConfig{
		WorkerCount:  1,
		PollInterval: time.Second,
		RateLimit:    2.0,
	})
	w := &Worker{pool: pool}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	go func() {
		_ = w.Start(ctx)
		close(done)
	}()

	// Give worker a moment to start
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-done:
		// Worker stopped successfully
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not stop within timeout")
	}
}

package pipeline

import (
	"context"
	"fmt"
)

// Processor is the interface for a single unit of work in the pipeline.
// T is the context type, R is the result type.
type Processor[T any, R any] interface {
	Name() string
	Process(ctx context.Context, pctx T) (R, error)
}

// ErrProcessorSkipped signals that a processor was skipped.
type ErrProcessorSkipped struct {
	Reason string
}

func (e *ErrProcessorSkipped) Error() string {
	return fmt.Sprintf("processor skipped: %s", e.Reason)
}

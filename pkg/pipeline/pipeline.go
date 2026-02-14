package pipeline

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// Pipeline coordinates the execution of stages.
type Pipeline[T any, R any] struct {
	stages      []*Stage[T, R]
	logger      *slog.Logger
	hooks       Hooks[T, R]
	accumulator func(T, R)
	merger      func(R, R) R
	metrics     Metrics
}

// Hooks allows project-specific logic to be injected into the pipeline execution.
type Hooks[T any, R any] interface {
	OnStageStart(ctx context.Context, pctx T, stage *Stage[T, R]) error
	OnStageEnd(ctx context.Context, stage *Stage[T, R], pctx T, mergedResult R, err error) error
	OnProcessorStart(ctx context.Context, pctx T, stage *Stage[T, R], proc Processor[T, R])
	OnProcessorEnd(ctx context.Context, pctx T, stage *Stage[T, R], proc Processor[T, R], result R, err error, duration time.Duration)
}

// NewPipeline creates a new Pipeline.
func NewPipeline[T any, R any](
	stages []*Stage[T, R],
	accumulator func(T, R),
	merger func(R, R) R,
	hooks Hooks[T, R],
	metrics Metrics,
	logger *slog.Logger,
) *Pipeline[T, R] {
	if metrics == nil {
		metrics = NoopMetrics{}
	}
	return &Pipeline[T, R]{
		stages:      stages,
		accumulator: accumulator,
		merger:      merger,
		hooks:       hooks,
		metrics:     metrics,
		logger:      logger,
	}
}

// Run executes the full pipeline for a given context.
func (p *Pipeline[T, R]) Run(ctx context.Context, pctx T) error {
	start := time.Now()
	var err error
	defer func() {
		p.metrics.RecordJob(time.Since(start), err == nil)
	}()

	for _, stage := range p.stages {
		if err = p.executeStage(ctx, pctx, stage); err != nil {
			return err
		}
	}
	return nil
}

func (p *Pipeline[T, R]) executeStage(ctx context.Context, pctx T, stage *Stage[T, R]) error {
	if p.hooks != nil {
		if err := p.hooks.OnStageStart(ctx, pctx, stage); err != nil {
			return err
		}
	}

	var mergedResult R
	var err error

	if stage.Concurrent {
		mergedResult, err = p.runConcurrent(ctx, pctx, stage)
	} else {
		mergedResult, err = p.runSequential(ctx, pctx, stage)
	}

	if p.hooks != nil {
		if hookErr := p.hooks.OnStageEnd(ctx, stage, pctx, mergedResult, err); hookErr != nil {
			if err == nil {
				err = hookErr
			}
		}
	}

	return err
}

func (p *Pipeline[T, R]) runConcurrent(ctx context.Context, pctx T, stage *Stage[T, R]) (R, error) {
	type procResult struct {
		proc   Processor[T, R]
		result R
		err    error
		dur    time.Duration
	}

	results := make([]procResult, len(stage.Processors))
	var wg sync.WaitGroup
	for i, proc := range stage.Processors {
		wg.Add(1)
		go func(idx int, pr Processor[T, R]) {
			defer wg.Done()
			if p.hooks != nil {
				p.hooks.OnProcessorStart(ctx, pctx, stage, pr)
			}
			start := time.Now()
			res, err := pr.Process(ctx, pctx)
			dur := time.Since(start)
			results[idx] = procResult{proc: pr, result: res, err: err, dur: dur}
			if p.hooks != nil {
				p.hooks.OnProcessorEnd(ctx, pctx, stage, pr, res, err, dur)
			}
		}(i, proc)
	}
	wg.Wait()

	var merged R
	var firstErr error
	for _, pr := range results {
		if pr.err != nil {
			if IsProcessorSkipped(pr.err) {
				continue
			}
			if firstErr == nil {
				firstErr = pr.err
			}
			continue
		}
		p.accumulator(pctx, pr.result)
		merged = p.merger(merged, pr.result)
	}

	return merged, firstErr
}

func (p *Pipeline[T, R]) runSequential(ctx context.Context, pctx T, stage *Stage[T, R]) (R, error) {
	var merged R
	for _, proc := range stage.Processors {
		if p.hooks != nil {
			p.hooks.OnProcessorStart(ctx, pctx, stage, proc)
		}
		start := time.Now()
		result, err := proc.Process(ctx, pctx)
		dur := time.Since(start)
		if p.hooks != nil {
			p.hooks.OnProcessorEnd(ctx, pctx, stage, proc, result, err, dur)
		}

		if err != nil {
			if IsProcessorSkipped(err) {
				continue
			}
			return merged, err
		}

		p.accumulator(pctx, result)
		merged = p.merger(merged, result)
	}
	return merged, nil
}

// IsProcessorSkipped returns true if err is ErrProcessorSkipped.
func IsProcessorSkipped(err error) bool {
	var target *ErrProcessorSkipped
	return errors.As(err, &target)
}

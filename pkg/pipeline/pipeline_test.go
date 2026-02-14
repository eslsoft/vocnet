package pipeline

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

type mockProcessor struct {
	name   string
	result string
	err    error
	delay  time.Duration
}

func (m *mockProcessor) Name() string { return m.name }
func (m *mockProcessor) Process(ctx context.Context, pctx *[]string) (string, error) {
	if m.delay > 0 {
		time.Sleep(m.delay)
	}
	if m.err != nil {
		return "", m.err
	}
	return m.result, nil
}

func TestPipeline_Run(t *testing.T) {
	pctx := &[]string{}
	accumulator := func(ctx *[]string, res string) {
		*ctx = append(*ctx, res)
	}
	merger := func(dst, src string) string {
		return dst + src
	}

	stages := []*Stage[*[]string, string]{
		NewStage("s1", 1,
			&mockProcessor{name: "p1", result: "a"},
			&mockProcessor{name: "p2", result: "b"},
		),
		NewConcurrentStage("s2", 2,
			&mockProcessor{name: "p3", result: "c", delay: 10 * time.Millisecond},
			&mockProcessor{name: "p4", result: "d", delay: 5 * time.Millisecond},
		),
	}

	p := NewPipeline(stages, accumulator, merger, nil, nil, nil)
	err := p.Run(context.Background(), pctx)

	assert.NoError(t, err)
	assert.ElementsMatch(t, []string{"a", "b", "c", "d"}, *pctx)
}

func TestPipeline_ProcessorSkip(t *testing.T) {
	pctx := &[]string{}
	accumulator := func(ctx *[]string, res string) {
		*ctx = append(*ctx, res)
	}
	merger := func(dst, src string) string {
		return dst + src
	}

	stages := []*Stage[*[]string, string]{
		NewStage("s1", 1,
			&mockProcessor{name: "p1", err: &ErrProcessorSkipped{Reason: "test"}},
			&mockProcessor{name: "p2", result: "b"},
		),
	}

	p := NewPipeline(stages, accumulator, merger, nil, nil, nil)
	err := p.Run(context.Background(), pctx)

	assert.NoError(t, err)
	assert.Equal(t, []string{"b"}, *pctx)
}

func TestPipeline_StageError(t *testing.T) {
	pctx := &[]string{}
	accumulator := func(ctx *[]string, res string) {
		*ctx = append(*ctx, res)
	}
	merger := func(dst, src string) string {
		return dst + src
	}

	expectedErr := errors.New("fatal")
	stages := []*Stage[*[]string, string]{
		NewStage("s1", 1,
			&mockProcessor{name: "p1", err: expectedErr},
		),
		NewStage("s2", 2,
			&mockProcessor{name: "p2", result: "b"},
		),
	}

	p := NewPipeline(stages, accumulator, merger, nil, nil, nil)
	err := p.Run(context.Background(), pctx)

	assert.ErrorIs(t, err, expectedErr)
	assert.Empty(t, *pctx) // Should stop after first stage error
}

type mockHooks struct {
	onStageStart func(ctx context.Context, pctx *[]string, stage *Stage[*[]string, string]) error
}

func (m *mockHooks) OnStageStart(ctx context.Context, pctx *[]string, stage *Stage[*[]string, string]) error {
	if m.onStageStart != nil {
		return m.onStageStart(ctx, pctx, stage)
	}
	return nil
}
func (m *mockHooks) OnStageEnd(ctx context.Context, stage *Stage[*[]string, string], pctx *[]string, mergedResult string, err error) error {
	return nil
}
func (m *mockHooks) OnProcessorStart(ctx context.Context, pctx *[]string, stage *Stage[*[]string, string], proc Processor[*[]string, string]) {
}
func (m *mockHooks) OnProcessorEnd(ctx context.Context, pctx *[]string, stage *Stage[*[]string, string], proc Processor[*[]string, string], result string, err error, duration time.Duration) {
}

func TestPipeline_Hooks(t *testing.T) {
	pctx := &[]string{}
	accumulator := func(ctx *[]string, res string) {
		*ctx = append(*ctx, res)
	}
	merger := func(dst, src string) string { return dst + src }

	called := false
	hooks := &mockHooks{
		onStageStart: func(ctx context.Context, pctx *[]string, stage *Stage[*[]string, string]) error {
			called = true
			return nil
		},
	}

	stages := []*Stage[*[]string, string]{
		NewStage("s1", 1, &mockProcessor{name: "p1", result: "a"}),
	}

	p := NewPipeline(stages, accumulator, merger, hooks, nil, nil)
	err := p.Run(context.Background(), pctx)

	assert.NoError(t, err)
	assert.True(t, called)
}

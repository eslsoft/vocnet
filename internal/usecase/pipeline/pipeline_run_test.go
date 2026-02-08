package pipeline

import (
	"context"
	"errors"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/mocks"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memoryTaskRepo struct {
	tasksByPhase map[int32]*entity.PipelineTask
	nextID       int64
}

func newMemoryTaskRepo() *memoryTaskRepo {
	return &memoryTaskRepo{
		tasksByPhase: make(map[int32]*entity.PipelineTask),
		nextID:       1,
	}
}

func (m *memoryTaskRepo) CreateOrUpdate(ctx context.Context, task *entity.PipelineTask) (*entity.PipelineTask, error) {
	if existing, ok := m.tasksByPhase[task.Phase]; ok {
		existing.Status = task.Status
		existing.Tier = task.Tier
		return existing, nil
	}

	copied := *task
	copied.ID = m.nextID
	m.nextID++
	m.tasksByPhase[task.Phase] = &copied
	return &copied, nil
}

func (m *memoryTaskRepo) GetByLemmaAndPhase(ctx context.Context, lemmaID int64, phase int32) (*entity.PipelineTask, error) {
	task, ok := m.tasksByPhase[phase]
	if !ok {
		return nil, errors.New("task not found")
	}
	return task, nil
}

func (m *memoryTaskRepo) ListByLemma(ctx context.Context, lemmaID int64) ([]*entity.PipelineTask, error) {
	out := make([]*entity.PipelineTask, 0, len(m.tasksByPhase))
	for _, task := range m.tasksByPhase {
		out = append(out, task)
	}
	return out, nil
}

func (m *memoryTaskRepo) UpdateStatus(ctx context.Context, id int64, status entity.TaskStatus, errorMsg string) error {
	for _, task := range m.tasksByPhase {
		if task.ID == id {
			task.Status = status
			task.ErrorMessage = errorMsg
			return nil
		}
	}
	return errors.New("task not found")
}

type nopSnapshotRepo struct{}

func (n *nopSnapshotRepo) CreateOrUpdate(ctx context.Context, snapshot *entity.WordSnapshot) (*entity.WordSnapshot, error) {
	return snapshot, nil
}

func (n *nopSnapshotRepo) GetByLemma(ctx context.Context, lemmaID int64) (*entity.WordSnapshot, error) {
	return nil, nil
}

func (n *nopSnapshotRepo) GetByTerm(ctx context.Context, term string, language string) (*entity.WordSnapshot, error) {
	return nil, nil
}

type stubProcessor struct {
	name      string
	processFn func(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error)
}

func (s *stubProcessor) Name() string { return s.name }

func (s *stubProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	return s.processFn(ctx, pctx)
}

func TestPipelineRun_AbortOnStageError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	lemmaRepo := mocks.NewMockLemmaRepository(ctrl)
	lexemeRepo := mocks.NewMockLexemeRepository(ctrl)

	existingLemma := &entity.Lemma{ID: 100, Surface: "mission"}
	lemmaRepo.EXPECT().
		LookupByForm(gomock.Any(), "mission", entity.LanguageEnglish).
		Return(existingLemma, nil)
	lexemeRepo.EXPECT().
		ListByLemmaID(gomock.Any(), existingLemma.ID).
		Return(nil, nil)

	stage2Executed := false
	taskRepo := newMemoryTaskRepo()

	p := NewPipeline(
		[]*Stage{
			NewStage("discovery", 1, &stubProcessor{
				name: "wikidata",
				processFn: func(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
					return nil, errors.New("wikidata failed")
				},
			}),
			NewStage("lexical", 2, &stubProcessor{
				name: "ecdict",
				processFn: func(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
					stage2Executed = true
					return &ProcessResult{Status: ProcessStatusNoData}, nil
				},
			}),
		},
		NewValidator(lemmaRepo, lexemeRepo, testLogger()),
		nil,
		taskRepo,
		&nopSnapshotRepo{},
		lemmaRepo,
		lexemeRepo,
		testLogger(),
	)

	result, err := p.Run(context.Background(), "mission", "en", 2, nil)
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "execute stage 1")
	assert.False(t, stage2Executed, "next stage should not execute after stage error")

	stage1Task, err := taskRepo.GetByLemmaAndPhase(context.Background(), existingLemma.ID, 1)
	require.NoError(t, err)
	assert.Equal(t, entity.TaskStatusFailed, stage1Task.Status)

	stage2Task, err := taskRepo.GetByLemmaAndPhase(context.Background(), existingLemma.ID, 2)
	require.NoError(t, err)
	assert.Equal(t, entity.TaskStatusPending, stage2Task.Status)
}

func TestPipelineRun_ContinueOnExplicitProcessorSkip(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	lemmaRepo := mocks.NewMockLemmaRepository(ctrl)
	lexemeRepo := mocks.NewMockLexemeRepository(ctrl)

	existingLemma := &entity.Lemma{ID: 200, Surface: "mission"}
	lemmaRepo.EXPECT().
		LookupByForm(gomock.Any(), "mission", entity.LanguageEnglish).
		Return(existingLemma, nil)
	lexemeRepo.EXPECT().
		ListByLemmaID(gomock.Any(), existingLemma.ID).
		Return(nil, nil)

	stage2Executed := false
	taskRepo := newMemoryTaskRepo()

	p := NewPipeline(
		[]*Stage{
			NewStage("discovery", 1, &stubProcessor{
				name: "wikidata",
				processFn: func(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
					return nil, &ErrProcessorSkipped{Reason: "wikidata not available"}
				},
			}),
			NewStage("lexical", 2, &stubProcessor{
				name: "ecdict",
				processFn: func(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
					stage2Executed = true
					return &ProcessResult{Status: ProcessStatusNoData}, nil
				},
			}),
		},
		NewValidator(lemmaRepo, lexemeRepo, testLogger()),
		nil,
		taskRepo,
		&nopSnapshotRepo{},
		lemmaRepo,
		lexemeRepo,
		testLogger(),
	)

	result, err := p.Run(context.Background(), "mission", "en", 2, nil)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, stage2Executed, "explicit skip should not abort subsequent stages")

	stage1Task, err := taskRepo.GetByLemmaAndPhase(context.Background(), existingLemma.ID, 1)
	require.NoError(t, err)
	assert.Equal(t, entity.TaskStatusSkipped, stage1Task.Status)

	stage2Task, err := taskRepo.GetByLemmaAndPhase(context.Background(), existingLemma.ID, 2)
	require.NoError(t, err)
	assert.Equal(t, entity.TaskStatusSkipped, stage2Task.Status)
}

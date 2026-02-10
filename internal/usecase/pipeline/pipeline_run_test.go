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

type memoryStageRepo struct {
	stagesByPhase map[int32]*entity.PipelineStage
	nextID        int64
}

func newMemoryStageRepo() *memoryStageRepo {
	return &memoryStageRepo{
		stagesByPhase: make(map[int32]*entity.PipelineStage),
		nextID:        1,
	}
}

func (m *memoryStageRepo) CreateOrUpdate(ctx context.Context, stage *entity.PipelineStage) (*entity.PipelineStage, error) {
	if existing, ok := m.stagesByPhase[stage.Phase]; ok {
		existing.Status = stage.Status
		existing.Tier = stage.Tier
		existing.JobID = stage.JobID
		return existing, nil
	}

	copied := *stage
	copied.ID = m.nextID
	m.nextID++
	m.stagesByPhase[stage.Phase] = &copied
	return &copied, nil
}

func (m *memoryStageRepo) GetByJobAndPhase(ctx context.Context, jobID int64, phase int32) (*entity.PipelineStage, error) {
	stage, ok := m.stagesByPhase[phase]
	if !ok {
		return nil, errors.New("stage not found")
	}
	if stage.JobID != jobID {
		return nil, errors.New("stage not found")
	}
	return stage, nil
}

func (m *memoryStageRepo) ListByJob(ctx context.Context, jobID int64) ([]*entity.PipelineStage, error) {
	out := make([]*entity.PipelineStage, 0, len(m.stagesByPhase))
	for _, stage := range m.stagesByPhase {
		if stage.JobID == jobID {
			out = append(out, stage)
		}
	}
	return out, nil
}

func (m *memoryStageRepo) UpdateStatus(ctx context.Context, id int64, status entity.StageStatus, errorMsg string) error {
	for _, stage := range m.stagesByPhase {
		if stage.ID == id {
			stage.Status = status
			stage.ErrorMessage = errorMsg
			return nil
		}
	}
	return errors.New("stage not found")
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

func (n *nopSnapshotRepo) ListLatestByLemmaIDs(ctx context.Context, lemmaIDs []int64) (map[int64]*entity.WordSnapshot, error) {
	return map[int64]*entity.WordSnapshot{}, nil
}

func (n *nopSnapshotRepo) ListLatest(ctx context.Context, pageNo int32, pageSize int32, keyword string) ([]*entity.WordSnapshot, int64, error) {
	return []*entity.WordSnapshot{}, 0, nil
}

func (n *nopSnapshotRepo) ListByLemmaID(ctx context.Context, lemmaID int64, pageNo int32, pageSize int32) ([]*entity.WordSnapshot, int64, error) {
	return []*entity.WordSnapshot{}, 0, nil
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
	stageRepo := newMemoryStageRepo()

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
		stageRepo,
		&nopSnapshotRepo{},
		lemmaRepo,
		lexemeRepo,
		testLogger(),
	)

	result, err := p.Run(context.Background(), 1, "mission", "en", 2, nil)
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "execute stage 1")
	assert.False(t, stage2Executed, "next stage should not execute after stage error")

	stage1, err := stageRepo.GetByJobAndPhase(context.Background(), 1, 1)
	require.NoError(t, err)
	assert.Equal(t, entity.StageStatusFailed, stage1.Status)

	stage2, err := stageRepo.GetByJobAndPhase(context.Background(), 1, 2)
	require.NoError(t, err)
	assert.Equal(t, entity.StageStatusPending, stage2.Status)
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
	stageRepo := newMemoryStageRepo()

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
		stageRepo,
		&nopSnapshotRepo{},
		lemmaRepo,
		lexemeRepo,
		testLogger(),
	)

	result, err := p.Run(context.Background(), 1, "mission", "en", 2, nil)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, stage2Executed, "explicit skip should not abort subsequent stages")

	stage1, err := stageRepo.GetByJobAndPhase(context.Background(), 1, 1)
	require.NoError(t, err)
	assert.Equal(t, entity.StageStatusSkipped, stage1.Status)

	stage2, err := stageRepo.GetByJobAndPhase(context.Background(), 1, 2)
	require.NoError(t, err)
	assert.Equal(t, entity.StageStatusSkipped, stage2.Status)
}

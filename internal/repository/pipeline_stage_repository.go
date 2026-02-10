package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// PipelineStageRepository manages pipeline stage state.
type PipelineStageRepository interface {
	CreateOrUpdate(ctx context.Context, stage *entity.PipelineStage) (*entity.PipelineStage, error)
	GetByJobAndPhase(ctx context.Context, jobID int64, phase int32) (*entity.PipelineStage, error)
	ListByJob(ctx context.Context, jobID int64) ([]*entity.PipelineStage, error)
	UpdateStatus(ctx context.Context, id int64, status entity.StageStatus, errorMsg string) error
}

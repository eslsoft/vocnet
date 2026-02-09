package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// PipelineTaskRepository manages pipeline task state.
type PipelineTaskRepository interface {
	CreateOrUpdate(ctx context.Context, task *entity.PipelineTask) (*entity.PipelineTask, error)
	GetByJobAndPhase(ctx context.Context, jobID int64, phase int32) (*entity.PipelineTask, error)
	ListByJob(ctx context.Context, jobID int64) ([]*entity.PipelineTask, error)
	UpdateStatus(ctx context.Context, id int64, status entity.TaskStatus, errorMsg string) error
}

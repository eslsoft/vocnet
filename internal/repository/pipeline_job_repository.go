package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// PipelineJobRepository manages pipeline async jobs.
type PipelineJobRepository interface {
	Create(ctx context.Context, job *entity.PipelineJob) (*entity.PipelineJob, error)
	GetByID(ctx context.Context, id int64) (*entity.PipelineJob, error)
	List(ctx context.Context, status *entity.JobStatus, limit int) ([]*entity.PipelineJob, error)

	// ClaimNextBatch atomically claims up to limit PENDING jobs.
	ClaimNextBatch(ctx context.Context, limit int) ([]*entity.PipelineJob, error)

	// UpdateStatus updates the job status and optional error message.
	UpdateStatus(ctx context.Context, id int64, status entity.JobStatus, errorMsg string) error

	// CountByStatus counts the number of jobs with the given status.
	CountByStatus(ctx context.Context, status entity.JobStatus) (int, error)

	// ChangeStatus performs a validated state transition (pause/resume/cancel/retry).
	ChangeStatus(ctx context.Context, id int64, action entity.JobAction) error
}

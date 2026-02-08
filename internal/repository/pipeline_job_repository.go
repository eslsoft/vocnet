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

	// ClaimNext atomically claims the next PENDING job (CAS: PENDING → RUNNING).
	ClaimNext(ctx context.Context) (*entity.PipelineJob, error)

	// IncrementProcessed atomically increments the processed counter.
	IncrementProcessed(ctx context.Context, id int64) error
	// IncrementSkipped atomically increments the skipped counter.
	IncrementSkipped(ctx context.Context, id int64) error
	// IncrementFailed atomically increments the failed counter.
	IncrementFailed(ctx context.Context, id int64) error

	// UpdateStatus updates the job status and optional error message.
	UpdateStatus(ctx context.Context, id int64, status entity.JobStatus, errorMsg string) error

	// ChangeStatus performs a validated state transition (pause/resume/cancel/retry).
	ChangeStatus(ctx context.Context, id int64, action entity.JobAction) error
}

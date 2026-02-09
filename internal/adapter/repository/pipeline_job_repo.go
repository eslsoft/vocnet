package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entpipelinejob "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/pipelinejob"
	"github.com/eslsoft/vocnet/internal/repository"
)

type pipelineJobRepository struct {
	client *entdb.Client
}

func NewPipelineJobRepository(client *entdb.Client) repository.PipelineJobRepository {
	return &pipelineJobRepository{client: client}
}

func (r *pipelineJobRepository) Create(ctx context.Context, job *entity.PipelineJob) (*entity.PipelineJob, error) {
	if job == nil {
		return nil, entity.ErrInvalidInput
	}
	job.Term = strings.TrimSpace(job.Term)

	// Idempotent enqueue for single-word jobs:
	// if the same term (case-insensitive) is already pending/running in the same language,
	// return that existing job instead of creating a duplicate concurrent candidate.
	if job.Term != "" {
		active, err := r.client.PipelineJob.Query().
			Where(
				entpipelinejob.StatusIn(string(entity.JobStatusPending), string(entity.JobStatusRunning)),
				entpipelinejob.LanguageEQ(job.Language),
				entpipelinejob.TermEqualFold(job.Term),
			).
			Order(entpipelinejob.ByCreatedAt()).
			First(ctx)
		if err == nil {
			return mapEntPipelineJob(active), nil
		}
		if err != nil && !entdb.IsNotFound(err) {
			return nil, fmt.Errorf("find active job by term: %w", err)
		}
	}

	create := r.client.PipelineJob.Create().
		SetJobType(string(job.JobType)).
		SetStatus(string(job.Status)).
		SetName(job.Name).
		SetLanguage(job.Language).
		SetTier(job.Tier).
		SetTotalTerms(job.TotalTerms)

	if job.Term != "" {
		create.SetTerm(job.Term)
	}
	if len(job.Terms) > 0 {
		create.SetTerms(job.Terms)
	}

	row, err := create.Save(ctx)
	if err != nil {
		return nil, translateDBError(err, "pipeline_job")
	}

	return mapEntPipelineJob(row), nil
}

func (r *pipelineJobRepository) GetByID(ctx context.Context, id int64) (*entity.PipelineJob, error) {
	row, err := r.client.PipelineJob.Get(ctx, id)
	if err != nil {
		return nil, translateDBError(err, "pipeline_job")
	}
	return mapEntPipelineJob(row), nil
}

func (r *pipelineJobRepository) List(ctx context.Context, status *entity.JobStatus, limit int) ([]*entity.PipelineJob, error) {
	query := r.client.PipelineJob.Query().
		Order(entpipelinejob.ByCreatedAt(sql.OrderDesc()))

	if status != nil {
		query.Where(entpipelinejob.StatusEQ(string(*status)))
	}
	if limit > 0 {
		query.Limit(limit)
	}

	rows, err := query.All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list pipeline jobs: %w", err)
	}

	out := make([]*entity.PipelineJob, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntPipelineJob(row))
	}
	return out, nil
}

func (r *pipelineJobRepository) ClaimNextBatch(ctx context.Context, limit int) ([]*entity.PipelineJob, error) {
	return r.claimBatch(ctx, limit)
}

func (r *pipelineJobRepository) claimBatch(ctx context.Context, limit int) ([]*entity.PipelineJob, error) {
	if limit <= 0 {
		return nil, nil
	}

	out := make([]*entity.PipelineJob, 0, limit)
	for range limit {
		row, err := r.claimOneTx(ctx)
		if err != nil {
			return nil, err
		}
		if row == nil {
			break
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *pipelineJobRepository) claimOneTx(ctx context.Context) (*entity.PipelineJob, error) {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}

	// Find oldest pending candidates and pick the first that is not blocked by
	// another RUNNING job of the same term+language.
	candidates, err := tx.PipelineJob.Query().
		Where(entpipelinejob.StatusEQ(string(entity.JobStatusPending))).
		Order(entpipelinejob.ByCreatedAt()).
		Limit(32).
		All(ctx)
	if err != nil {
		_ = tx.Rollback()
		if entdb.IsNotFound(err) {
			return nil, nil // No pending jobs
		}
		return nil, fmt.Errorf("query pending job: %w", err)
	}
	if len(candidates) == 0 {
		_ = tx.Rollback()
		return nil, nil
	}

	var claimedID int64
	for _, row := range candidates {
		if row == nil {
			continue
		}
		// Prevent simultaneous execution for same term in same language.
		if row.Term != "" {
			runningCount, err := tx.PipelineJob.Query().
				Where(
					entpipelinejob.StatusEQ(string(entity.JobStatusRunning)),
					entpipelinejob.LanguageEQ(row.Language),
					entpipelinejob.TermEqualFold(row.Term),
				).
				Count(ctx)
			if err != nil {
				_ = tx.Rollback()
				return nil, fmt.Errorf("check running duplicate term: %w", err)
			}
			if runningCount > 0 {
				continue
			}
		}

		// CAS: PENDING → RUNNING (only if still PENDING to prevent double-claim)
		now := time.Now()
		affected, err := tx.PipelineJob.Update().
			Where(
				entpipelinejob.ID(row.ID),
				entpipelinejob.StatusEQ(string(entity.JobStatusPending)),
			).
			SetStatus(string(entity.JobStatusRunning)).
			SetStartedAt(now).
			Save(ctx)
		if err != nil {
			_ = tx.Rollback()
			return nil, fmt.Errorf("claim job: %w", err)
		}
		if affected == 0 {
			continue
		}
		claimedID = row.ID
		break
	}
	if claimedID == 0 {
		_ = tx.Rollback()
		return nil, nil
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	// Re-read the row to get the updated state
	updated, err := r.client.PipelineJob.Get(ctx, claimedID)
	if err != nil {
		return nil, fmt.Errorf("read claimed job: %w", err)
	}

	return mapEntPipelineJob(updated), nil
}

func (r *pipelineJobRepository) IncrementProcessed(ctx context.Context, id int64) error {
	_, err := r.client.PipelineJob.UpdateOneID(id).
		AddProcessed(1).
		Save(ctx)
	if err != nil {
		return translateDBError(err, "pipeline_job")
	}
	return nil
}

func (r *pipelineJobRepository) IncrementSkipped(ctx context.Context, id int64) error {
	_, err := r.client.PipelineJob.UpdateOneID(id).
		AddSkipped(1).
		Save(ctx)
	if err != nil {
		return translateDBError(err, "pipeline_job")
	}
	return nil
}

func (r *pipelineJobRepository) IncrementFailed(ctx context.Context, id int64) error {
	_, err := r.client.PipelineJob.UpdateOneID(id).
		AddFailed(1).
		Save(ctx)
	if err != nil {
		return translateDBError(err, "pipeline_job")
	}
	return nil
}

func (r *pipelineJobRepository) UpdateStatus(ctx context.Context, id int64, status entity.JobStatus, errorMsg string) error {
	update := r.client.PipelineJob.UpdateOneID(id).
		SetStatus(string(status))

	if errorMsg != "" {
		update.SetErrorMessage(errorMsg)
	}

	now := time.Now()
	switch status {
	case entity.JobStatusRunning:
		update.SetStartedAt(now)
	case entity.JobStatusCompleted, entity.JobStatusFailed, entity.JobStatusCancelled:
		update.SetCompletedAt(now)
	}

	_, err := update.Save(ctx)
	if err != nil {
		return translateDBError(err, "pipeline_job")
	}
	return nil
}

func (r *pipelineJobRepository) CountByStatus(ctx context.Context, status entity.JobStatus) (int, error) {
	count, err := r.client.PipelineJob.Query().
		Where(entpipelinejob.StatusEQ(string(status))).
		Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("count pipeline jobs by status: %w", err)
	}
	return count, nil
}

func (r *pipelineJobRepository) ChangeStatus(ctx context.Context, id int64, action entity.JobAction) error {
	job, err := r.client.PipelineJob.Get(ctx, id)
	if err != nil {
		return translateDBError(err, "pipeline_job")
	}

	status := entity.JobStatus(job.Status)
	if err := status.ValidateTransition(action); err != nil {
		return err
	}

	targetStatus := action.TargetStatus()
	update := r.client.PipelineJob.UpdateOneID(id).
		SetStatus(string(targetStatus))

	// Handle action-specific side effects
	now := time.Now()
	switch action {
	case entity.JobActionCancel:
		update.SetCompletedAt(now)
	case entity.JobActionRetry:
		update.ClearStartedAt().ClearCompletedAt().ClearErrorMessage()
	}

	_, err = update.Save(ctx)
	if err != nil {
		return translateDBError(err, "pipeline_job")
	}
	return nil
}

func mapEntPipelineJob(row *entdb.PipelineJob) *entity.PipelineJob {
	if row == nil {
		return nil
	}
	return &entity.PipelineJob{
		ID:           row.ID,
		JobType:      entity.JobType(row.JobType),
		Status:       entity.JobStatus(row.Status),
		Name:         row.Name,
		Language:     row.Language,
		Tier:         row.Tier,
		Term:         row.Term,
		Terms:        row.Terms,
		TotalTerms:   row.TotalTerms,
		Processed:    row.Processed,
		Skipped:      row.Skipped,
		Failed:       row.Failed,
		ErrorMessage: row.ErrorMessage,
		StartedAt:    row.StartedAt,
		CompletedAt:  row.CompletedAt,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}
}

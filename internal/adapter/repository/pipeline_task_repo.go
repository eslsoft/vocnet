package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entpipelinetask "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/pipelinetask"
	"github.com/eslsoft/vocnet/internal/repository"
)

type pipelineTaskRepository struct {
	client *entdb.Client
}

func NewPipelineTaskRepository(client *entdb.Client) repository.PipelineTaskRepository {
	return &pipelineTaskRepository{client: client}
}

func (r *pipelineTaskRepository) CreateOrUpdate(ctx context.Context, task *entity.PipelineTask) (*entity.PipelineTask, error) {
	if task == nil {
		return nil, entity.ErrInvalidInput
	}

	row, err := r.client.PipelineTask.Create().
		SetJobID(task.JobID).
		SetLemmaID(task.LemmaID).
		SetPhase(task.Phase).
		SetStatus(string(task.Status)).
		SetTier(task.Tier).
		SetAttempts(task.Attempts).
		OnConflictColumns("job_id", "phase").
		UpdateNewValues().
		ID(ctx)
	if err != nil {
		return nil, translateDBError(err, "pipeline_task")
	}

	return r.getByID(ctx, row)
}

func (r *pipelineTaskRepository) GetByJobAndPhase(ctx context.Context, jobID int64, phase int32) (*entity.PipelineTask, error) {
	row, err := r.client.PipelineTask.Query().
		Where(
			entpipelinetask.JobIDEQ(jobID),
			entpipelinetask.PhaseEQ(phase),
		).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, fmt.Errorf("get pipeline task: %w", err)
	}
	return mapEntPipelineTask(row), nil
}

func (r *pipelineTaskRepository) ListByJob(ctx context.Context, jobID int64) ([]*entity.PipelineTask, error) {
	rows, err := r.client.PipelineTask.Query().
		Where(entpipelinetask.JobIDEQ(jobID)).
		Order(entpipelinetask.ByPhase()).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list pipeline tasks: %w", err)
	}
	out := make([]*entity.PipelineTask, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntPipelineTask(row))
	}
	return out, nil
}

func (r *pipelineTaskRepository) UpdateStatus(ctx context.Context, id int64, status entity.TaskStatus, errorMsg string) error {
	update := r.client.PipelineTask.UpdateOneID(id).
		SetStatus(string(status)).
		SetErrorMessage(errorMsg)

	now := time.Now()
	switch status {
	case entity.TaskStatusRunning:
		update.SetStartedAt(now)
	case entity.TaskStatusCompleted, entity.TaskStatusFailed, entity.TaskStatusSkipped:
		update.SetCompletedAt(now)
	}

	_, err := update.Save(ctx)
	if err != nil {
		return translateDBError(err, "pipeline_task")
	}
	return nil
}

func (r *pipelineTaskRepository) getByID(ctx context.Context, id int64) (*entity.PipelineTask, error) {
	row, err := r.client.PipelineTask.Get(ctx, id)
	if err != nil {
		return nil, translateDBError(err, "pipeline_task")
	}
	return mapEntPipelineTask(row), nil
}

func mapEntPipelineTask(row *entdb.PipelineTask) *entity.PipelineTask {
	if row == nil {
		return nil
	}
	return &entity.PipelineTask{
		ID:           row.ID,
		JobID:        row.JobID,
		LemmaID:      row.LemmaID,
		Phase:        row.Phase,
		Status:       entity.TaskStatus(row.Status),
		Tier:         row.Tier,
		Attempts:     row.Attempts,
		ErrorMessage: row.ErrorMessage,
		StartedAt:    row.StartedAt,
		CompletedAt:  row.CompletedAt,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}
}

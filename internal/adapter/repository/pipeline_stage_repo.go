package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entpipelinestage "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/pipelinestage"
	"github.com/eslsoft/vocnet/internal/repository"
)

type pipelineStageRepository struct {
	client *entdb.Client
}

func NewPipelineStageRepository(client *entdb.Client) repository.PipelineStageRepository {
	return &pipelineStageRepository{client: client}
}

func (r *pipelineStageRepository) CreateOrUpdate(ctx context.Context, stage *entity.PipelineStage) (*entity.PipelineStage, error) {
	if stage == nil {
		return nil, entity.ErrInvalidInput
	}

	row, err := r.client.PipelineStage.Create().
		SetJobID(stage.JobID).
		SetLemmaID(stage.LemmaID).
		SetPhase(stage.Phase).
		SetStatus(string(stage.Status)).
		SetTier(stage.Tier).
		SetAttempts(stage.Attempts).
		OnConflictColumns("job_id", "phase").
		UpdateNewValues().
		ID(ctx)
	if err != nil {
		return nil, translateDBError(err, "pipeline_stage")
	}

	return r.getByID(ctx, row)
}

func (r *pipelineStageRepository) GetByJobAndPhase(ctx context.Context, jobID int64, phase int32) (*entity.PipelineStage, error) {
	row, err := r.client.PipelineStage.Query().
		Where(
			entpipelinestage.JobIDEQ(jobID),
			entpipelinestage.PhaseEQ(phase),
		).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, fmt.Errorf("get pipeline stage: %w", err)
	}
	return mapEntPipelineStage(row), nil
}

func (r *pipelineStageRepository) ListByJob(ctx context.Context, jobID int64) ([]*entity.PipelineStage, error) {
	rows, err := r.client.PipelineStage.Query().
		Where(entpipelinestage.JobIDEQ(jobID)).
		Order(entpipelinestage.ByPhase()).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list pipeline stages: %w", err)
	}
	out := make([]*entity.PipelineStage, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntPipelineStage(row))
	}
	return out, nil
}

func (r *pipelineStageRepository) UpdateStatus(ctx context.Context, id int64, status entity.StageStatus, errorMsg string) error {
	update := r.client.PipelineStage.UpdateOneID(id).
		SetStatus(string(status)).
		SetErrorMessage(errorMsg)

	now := time.Now()
	switch status {
	case entity.StageStatusRunning:
		update.SetStartedAt(now)
	case entity.StageStatusCompleted, entity.StageStatusFailed, entity.StageStatusSkipped:
		update.SetCompletedAt(now)
	}

	_, err := update.Save(ctx)
	if err != nil {
		return translateDBError(err, "pipeline_stage")
	}
	return nil
}

func (r *pipelineStageRepository) getByID(ctx context.Context, id int64) (*entity.PipelineStage, error) {
	row, err := r.client.PipelineStage.Get(ctx, id)
	if err != nil {
		return nil, translateDBError(err, "pipeline_stage")
	}
	return mapEntPipelineStage(row), nil
}

func mapEntPipelineStage(row *entdb.PipelineStage) *entity.PipelineStage {
	if row == nil {
		return nil
	}
	return &entity.PipelineStage{
		ID:           row.ID,
		JobID:        row.JobID,
		LemmaID:      row.LemmaID,
		Phase:        row.Phase,
		Status:       entity.StageStatus(row.Status),
		Tier:         row.Tier,
		Attempts:     row.Attempts,
		ErrorMessage: row.ErrorMessage,
		StartedAt:    row.StartedAt,
		CompletedAt:  row.CompletedAt,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}
}

package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// TemporalJobActivity runs one pipeline job from Temporal activity.
type TemporalJobActivity struct {
	jobRepo   repository.PipelineJobRepository
	pipeline  *Pipeline
	logger    *slog.Logger
	processFn func(context.Context, *entity.PipelineJob, *slog.Logger) error
}

func NewTemporalJobActivity(
	jobRepo repository.PipelineJobRepository,
	pipeline *Pipeline,
	logger *slog.Logger,
) *TemporalJobActivity {
	if logger == nil {
		logger = slog.Default()
	}
	a := &TemporalJobActivity{
		jobRepo:  jobRepo,
		pipeline: pipeline,
		logger:   logger.With("component", "pipeline-temporal-activity"),
	}
	a.processFn = a.processJob
	return a
}

// Run is the Temporal activity entrypoint.
func (a *TemporalJobActivity) Run(ctx context.Context, input TemporalWorkflowInput) error {
	job, err := a.jobRepo.GetByID(ctx, input.JobID)
	if err != nil {
		return fmt.Errorf("get job %d: %w", input.JobID, err)
	}

	jobLogger := a.logger.With("job_id", job.ID)
	return a.processFn(ctx, job, jobLogger)
}

func (a *TemporalJobActivity) processJob(ctx context.Context, job *entity.PipelineJob, jobLogger *slog.Logger) error {
	jobStart := time.Now()

	currentJob, err := a.jobRepo.GetByID(ctx, job.ID)
	if err != nil {
		return fmt.Errorf("check current job status: %w", err)
	}

	switch currentJob.Status {
	case entity.JobStatusPaused:
		jobLogger.Info("job paused by user, skip processing")
		return nil
	case entity.JobStatusCancelled:
		jobLogger.Info("job cancelled by user, skip processing")
		return nil
	case entity.JobStatusCompleted:
		jobLogger.Info("job already completed, skip processing")
		return nil
	}

	if err := a.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusRunning, ""); err != nil {
		return fmt.Errorf("set running status: %w", err)
	}

	term := job.Term
	if term == "" && len(job.Terms) > 0 {
		term = job.Terms[0]
	}
	if term == "" {
		err := fmt.Errorf("empty term")
		_ = a.jobRepo.IncrementFailed(ctx, job.ID)
		_ = a.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusFailed, err.Error())
		return err
	}

	termLogger := jobLogger.With("term", term)
	termStart := time.Now()
	_, err = a.pipeline.Run(ctx, job.ID, term, job.Language, job.Tier, &RunOptions{Logger: termLogger})
	if err != nil {
		_ = a.jobRepo.IncrementFailed(ctx, job.ID)
		_ = a.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusFailed, err.Error())
		termLogger.Warn("failed to process term", "error", err)
		return err
	}

	if err := a.jobRepo.IncrementProcessed(ctx, job.ID); err != nil {
		return fmt.Errorf("increment processed: %w", err)
	}
	if err := a.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusCompleted, ""); err != nil {
		return fmt.Errorf("set completed status: %w", err)
	}

	jobLogger.Info(
		"job completed",
		"duration", time.Since(jobStart).String(),
		"term_duration", time.Since(termStart).String(),
	)
	return nil
}

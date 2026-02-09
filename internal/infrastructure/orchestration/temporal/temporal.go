package temporal

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
)

// NewClient creates a Temporal client from app config.
func NewClient(cfg *config.Config) (client.Client, error) {
	hostPort := strings.TrimSpace(cfg.Temporal.HostPort)
	if hostPort == "" {
		return nil, fmt.Errorf("temporal host port is required")
	}

	namespace := strings.TrimSpace(cfg.Temporal.Namespace)
	if namespace == "" {
		namespace = "default"
	}

	return client.Dial(client.Options{
		HostPort:  hostPort,
		Namespace: namespace,
	})
}

// Dispatcher starts a workflow for each submitted pipeline job.
type Dispatcher struct {
	client    client.Client
	taskQueue string
	logger    *slog.Logger
}

func NewDispatcher(c client.Client, taskQueue string, logger *slog.Logger) *Dispatcher {
	if logger == nil {
		logger = slog.Default()
	}
	if strings.TrimSpace(taskQueue) == "" {
		taskQueue = "vocnet-pipeline"
	}
	return &Dispatcher{client: c, taskQueue: taskQueue, logger: logger.With("component", "pipeline-temporal-dispatcher")}
}

func (d *Dispatcher) DispatchJob(ctx context.Context, job *entity.PipelineJob) error {
	if job == nil {
		return fmt.Errorf("job is nil")
	}

	workflowID := fmt.Sprintf("pipeline-job-%d", job.ID)
	startOpts := client.StartWorkflowOptions{
		ID:                    workflowID,
		TaskQueue:             d.taskQueue,
		WorkflowIDReusePolicy: enumspb.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE_FAILED_ONLY,
		WorkflowTaskTimeout:   10 * time.Second,
	}

	input := pipeline.TemporalWorkflowInput{JobID: job.ID}
	we, err := d.client.ExecuteWorkflow(ctx, startOpts, pipeline.PipelineJobWorkflow, input)
	if err != nil {
		return fmt.Errorf("execute workflow for job %d: %w", job.ID, err)
	}

	d.logger.Info("pipeline workflow dispatched", "job_id", job.ID, "workflow_id", we.GetID(), "run_id", we.GetRunID())
	return nil
}

func (d *Dispatcher) Close() {
	if d.client != nil {
		d.client.Close()
	}
}

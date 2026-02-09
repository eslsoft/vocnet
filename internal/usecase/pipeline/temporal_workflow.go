package pipeline

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// PipelineTemporalTaskQueue is the default Temporal task queue for pipeline workflows.
	PipelineTemporalTaskQueue = "vocnet-pipeline"
	// PipelineTemporalRunJobActivityName is the registered activity name to process one pipeline job.
	PipelineTemporalRunJobActivityName = "vocnet.pipeline.run_job.v1"
)

// TemporalWorkflowInput carries workflow input.
type TemporalWorkflowInput struct {
	JobID int64
}

// PipelineJobWorkflow executes one pipeline job.
func PipelineJobWorkflow(ctx workflow.Context, input TemporalWorkflowInput) error {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Hour,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    1 * time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	return workflow.ExecuteActivity(ctx, PipelineTemporalRunJobActivityName, input).Get(ctx, nil)
}

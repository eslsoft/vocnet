package entity

import (
	"fmt"
	"time"
)

// JobStatus represents the state of a pipeline job.
type JobStatus string

const (
	JobStatusPending   JobStatus = "PENDING"
	JobStatusRunning   JobStatus = "RUNNING"
	JobStatusPaused    JobStatus = "PAUSED"
	JobStatusCompleted JobStatus = "COMPLETED"
	JobStatusFailed    JobStatus = "FAILED"
	JobStatusCancelled JobStatus = "CANCELLED"
)

// IsTerminal returns true if the job status is a terminal state.
func (s JobStatus) IsTerminal() bool {
	return s == JobStatusCompleted || s == JobStatusFailed || s == JobStatusCancelled
}

// JobAction represents an action to perform on a job.
type JobAction string

const (
	JobActionPause  JobAction = "pause"
	JobActionResume JobAction = "resume"
	JobActionCancel JobAction = "cancel"
	JobActionRetry  JobAction = "retry"
)

// jobTransitions defines valid state transitions for each action.
var jobTransitions = map[JobAction]struct {
	from []JobStatus
	to   JobStatus
}{
	JobActionPause:  {from: []JobStatus{JobStatusPending, JobStatusRunning}, to: JobStatusPaused},
	JobActionResume: {from: []JobStatus{JobStatusPaused}, to: JobStatusPending},
	JobActionCancel: {from: []JobStatus{JobStatusPending, JobStatusRunning, JobStatusPaused}, to: JobStatusCancelled},
	JobActionRetry:  {from: []JobStatus{JobStatusFailed, JobStatusCancelled}, to: JobStatusPending},
}

// ValidateTransition checks if the action can be performed on the current status.
func (s JobStatus) ValidateTransition(action JobAction) error {
	transition, ok := jobTransitions[action]
	if !ok {
		return fmt.Errorf("unknown action: %s", action)
	}

	for _, valid := range transition.from {
		if s == valid {
			return nil
		}
	}

	return fmt.Errorf("cannot %s job with status %s", action, s)
}

// TargetStatus returns the target status for a given action.
func (action JobAction) TargetStatus() JobStatus {
	return jobTransitions[action].to
}

// PipelineJob represents an async pipeline processing job.
type PipelineJob struct {
	ID       int64
	Status   JobStatus
	Name     string
	Language string
	Tier     int32

	// Single word job
	Term string

	// Wordbook job
	Terms []string

	// Progress
	TotalTerms int32
	Processed  int32
	Skipped    int32
	Failed     int32

	ErrorMessage string

	StartedAt   *time.Time
	CompletedAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

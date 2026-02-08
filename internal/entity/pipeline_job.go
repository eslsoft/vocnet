package entity

import "time"

// JobStatus represents the state of a pipeline job.
type JobStatus string

const (
	JobStatusPending   JobStatus = "PENDING"
	JobStatusRunning   JobStatus = "RUNNING"
	JobStatusCompleted JobStatus = "COMPLETED"
	JobStatusFailed    JobStatus = "FAILED"
	JobStatusCancelled JobStatus = "CANCELLED"
)

// JobType represents the type of pipeline job.
type JobType string

const (
	JobTypeSingleWord JobType = "SINGLE_WORD"
	JobTypeWordbook   JobType = "WORDBOOK"
)

// PipelineJob represents an async pipeline processing job.
type PipelineJob struct {
	ID       int64
	JobType  JobType
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

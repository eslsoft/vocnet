package entity

import "time"

// TaskStatus represents the state of a pipeline task.
type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "PENDING"
	TaskStatusRunning   TaskStatus = "RUNNING"
	TaskStatusCompleted TaskStatus = "COMPLETED"
	TaskStatusFailed    TaskStatus = "FAILED"
	TaskStatusSkipped   TaskStatus = "SKIPPED"
)

// PipelinePhase enumerates the five pipeline stages.
type PipelinePhase int32

const (
	PhaseDiscovery     PipelinePhase = 1
	PhaseLexical       PipelinePhase = 2
	PhaseRelational    PipelinePhase = 3
	PhaseIntellectual  PipelinePhase = 4
	PhaseSynthesis     PipelinePhase = 5
)

// PhaseName returns a human-readable name for the phase.
func (p PipelinePhase) Name() string {
	switch p {
	case PhaseDiscovery:
		return "discovery"
	case PhaseLexical:
		return "lexical"
	case PhaseRelational:
		return "relational"
	case PhaseIntellectual:
		return "intellectual"
	case PhaseSynthesis:
		return "synthesis"
	default:
		return "unknown"
	}
}

// PipelineTask tracks the execution state of a single pipeline phase for a lemma.
type PipelineTask struct {
	ID           int64
	LemmaID      int64
	Phase        int32
	Status       TaskStatus
	Tier         int32 // 1=Core, 2=Extended, 3=LongTail
	Attempts     int32
	ErrorMessage string
	StartedAt    *time.Time
	CompletedAt  *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

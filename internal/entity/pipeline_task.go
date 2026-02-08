package entity

import (
	"fmt"
	"time"
)

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

// StageProgressSummary aggregates task statuses for display.
type StageProgressSummary struct {
	Total     int
	Completed int
	Failed    int
	Skipped   int
	Running   int
	Pending   int
}

// String returns a compact representation, e.g. "5/5" or "3/5 (skip:1, fail:1)".
func (s *StageProgressSummary) String() string {
	done := s.Completed + s.Failed + s.Skipped
	base := fmt.Sprintf("%d/%d", done, s.Total)

	var extras []string
	if s.Skipped > 0 {
		extras = append(extras, fmt.Sprintf("skip:%d", s.Skipped))
	}
	if s.Failed > 0 {
		extras = append(extras, fmt.Sprintf("fail:%d", s.Failed))
	}

	if len(extras) == 0 {
		return base
	}

	result := base + " ("
	for i, e := range extras {
		if i > 0 {
			result += ", "
		}
		result += e
	}
	result += ")"
	return result
}

// ComputeStageProgress computes a StageProgressSummary from a list of tasks.
func ComputeStageProgress(tasks []*PipelineTask) *StageProgressSummary {
	s := &StageProgressSummary{Total: len(tasks)}
	for _, t := range tasks {
		switch t.Status {
		case TaskStatusCompleted:
			s.Completed++
		case TaskStatusFailed:
			s.Failed++
		case TaskStatusSkipped:
			s.Skipped++
		case TaskStatusRunning:
			s.Running++
		case TaskStatusPending:
			s.Pending++
		}
	}
	return s
}

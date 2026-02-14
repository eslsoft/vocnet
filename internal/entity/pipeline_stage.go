package entity

import (
	"fmt"
	"time"
)

// StageStatus represents the state of a pipeline stage.
type StageStatus string

const (
	StageStatusPending   StageStatus = "PENDING"
	StageStatusRunning   StageStatus = "RUNNING"
	StageStatusCompleted StageStatus = "COMPLETED"
	StageStatusFailed    StageStatus = "FAILED"
	StageStatusSkipped   StageStatus = "SKIPPED"
)

// PipelineStage tracks the execution state of a single pipeline phase for a job.
type PipelineStage struct {
	ID           int64
	JobID        int64
	LemmaID      int64
	Phase        int32
	Status       StageStatus
	Tier         int32 // 1=Core, 2=Extended, 3=LongTail
	Attempts     int32
	ErrorMessage string
	StartedAt    *time.Time
	CompletedAt  *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// StageProgressSummary aggregates stage statuses for display.
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

// ComputeStageProgress computes a StageProgressSummary from a list of stages.
func ComputeStageProgress(stages []*PipelineStage) *StageProgressSummary {
	s := &StageProgressSummary{Total: len(stages)}
	for _, t := range stages {
		switch t.Status {
		case StageStatusCompleted:
			s.Completed++
		case StageStatusFailed:
			s.Failed++
		case StageStatusSkipped:
			s.Skipped++
		case StageStatusRunning:
			s.Running++
		case StageStatusPending:
			s.Pending++
		}
	}
	return s
}

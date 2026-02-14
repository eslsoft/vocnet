package pipeline

import (
	"time"
)

// Metrics defines the interface for pipeline performance tracking.
type Metrics interface {
	// RecordJob records the completion of a single job.
	RecordJob(duration time.Duration, succeeded bool)

	// SetPendingJobs updates the count of jobs waiting in the database.
	SetPendingJobs(count int64)

	// SetInFlightJobs updates the count of jobs currently being processed.
	SetInFlightJobs(count int64, workerCount int)
}

// NoopMetrics provides a neutral implementation of the Metrics interface.
type NoopMetrics struct{}

func (n NoopMetrics) RecordJob(duration time.Duration, succeeded bool) {}
func (n NoopMetrics) SetPendingJobs(count int64)                       {}
func (n NoopMetrics) SetInFlightJobs(count int64, workerCount int)     {}

package pipeline

import (
	"sync/atomic"
	"time"
)

// WorkerPoolMetrics tracks worker pool performance metrics.
type WorkerPoolMetrics struct {
	// Counters
	jobsProcessed atomic.Int64
	jobsSucceeded atomic.Int64
	jobsFailed    atomic.Int64

	// Timing
	startTime      time.Time
	totalDurationNs atomic.Int64 // total processing duration in nanoseconds

	// Rate tracking (sliding window)
	recentJobs      []jobRecord
	recentJobsMutex chan struct{} // simple mutex using channel
}

type jobRecord struct {
	timestamp time.Time
	durationNs int64
	succeeded  bool
}

// NewWorkerPoolMetrics creates a new metrics collector.
func NewWorkerPoolMetrics() *WorkerPoolMetrics {
	return &WorkerPoolMetrics{
		startTime:       time.Now(),
		recentJobs:      make([]jobRecord, 0, 1000),
		recentJobsMutex: make(chan struct{}, 1),
	}
}

// RecordJob records a completed job.
func (m *WorkerPoolMetrics) RecordJob(duration time.Duration, succeeded bool) {
	m.jobsProcessed.Add(1)
	if succeeded {
		m.jobsSucceeded.Add(1)
	} else {
		m.jobsFailed.Add(1)
	}
	m.totalDurationNs.Add(duration.Nanoseconds())

	// Add to recent jobs (for rate calculation)
	record := jobRecord{
		timestamp:  time.Now(),
		durationNs: duration.Nanoseconds(),
		succeeded:  succeeded,
	}

	m.recentJobsMutex <- struct{}{}
	defer func() { <-m.recentJobsMutex }()

	// Keep only last 5 minutes of records
	cutoff := time.Now().Add(-5 * time.Minute)
	filtered := make([]jobRecord, 0, len(m.recentJobs)+1)
	for _, r := range m.recentJobs {
		if r.timestamp.After(cutoff) {
			filtered = append(filtered, r)
		}
	}
	filtered = append(filtered, record)
	m.recentJobs = filtered
}

// Snapshot returns a point-in-time snapshot of metrics.
type MetricsSnapshot struct {
	// Uptime
	UptimeSeconds float64 `json:"uptime_seconds"`

	// Job counts
	JobsProcessed int64 `json:"jobs_processed"`
	JobsSucceeded int64 `json:"jobs_succeeded"`
	JobsFailed    int64 `json:"jobs_failed"`

	// Rate (jobs per minute, based on last 5 minutes)
	JobsPerMinute float64 `json:"jobs_per_minute"`

	// Average duration
	AvgDurationMs float64 `json:"avg_duration_ms"`

	// Recent rate (last minute)
	RecentJobsPerMinute float64 `json:"recent_jobs_per_minute"`
	RecentAvgDurationMs float64 `json:"recent_avg_duration_ms"`
}

// Snapshot returns current metrics.
func (m *WorkerPoolMetrics) Snapshot() MetricsSnapshot {
	now := time.Now()
	processed := m.jobsProcessed.Load()
	succeeded := m.jobsSucceeded.Load()
	failed := m.jobsFailed.Load()
	totalDuration := m.totalDurationNs.Load()

	snapshot := MetricsSnapshot{
		UptimeSeconds: now.Sub(m.startTime).Seconds(),
		JobsProcessed: processed,
		JobsSucceeded: succeeded,
		JobsFailed:    failed,
	}

	if processed > 0 {
		snapshot.AvgDurationMs = float64(totalDuration) / float64(processed) / 1e6
	}

	// Calculate rates from recent jobs
	m.recentJobsMutex <- struct{}{}
	defer func() { <-m.recentJobsMutex }()

	if len(m.recentJobs) > 0 {
		cutoff5min := now.Add(-5 * time.Minute)
		cutoff1min := now.Add(-1 * time.Minute)

		var count5min, count1min int64
		var duration5min, duration1min int64

		for _, r := range m.recentJobs {
			if r.timestamp.After(cutoff5min) {
				count5min++
				duration5min += r.durationNs
			}
			if r.timestamp.After(cutoff1min) {
				count1min++
				duration1min += r.durationNs
			}
		}

		if count5min > 0 {
			elapsed5min := now.Sub(cutoff5min).Minutes()
			if elapsed5min > 0 {
				snapshot.JobsPerMinute = float64(count5min) / elapsed5min
			}
		}

		if count1min > 0 {
			snapshot.RecentJobsPerMinute = float64(count1min)
			snapshot.RecentAvgDurationMs = float64(duration1min) / float64(count1min) / 1e6
		}
	}

	return snapshot
}

// Reset resets all metrics.
func (m *WorkerPoolMetrics) Reset() {
	m.jobsProcessed.Store(0)
	m.jobsSucceeded.Store(0)
	m.jobsFailed.Store(0)
	m.totalDurationNs.Store(0)
	m.startTime = time.Now()

	m.recentJobsMutex <- struct{}{}
	m.recentJobs = make([]jobRecord, 0, 1000)
	<-m.recentJobsMutex
}

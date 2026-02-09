package pipeline

import (
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// WorkerPoolMetrics tracks worker pool performance metrics using Prometheus.
type WorkerPoolMetrics struct {
	// Prometheus metrics
	jobsProcessed *prometheus.CounterVec
	jobDuration   prometheus.Histogram
	jobsPerMinute prometheus.Gauge
	uptime        prometheus.Gauge

	// Internal tracking for rate calculation
	startTime       time.Time
	recentJobs      []jobRecord
	recentJobsMutex chan struct{}

	// Atomic counters for snapshot
	processed atomic.Int64
	succeeded atomic.Int64
	failed    atomic.Int64
}

type jobRecord struct {
	timestamp  time.Time
	durationNs int64
}

// NewWorkerPoolMetrics creates a new metrics collector with Prometheus registration.
func NewWorkerPoolMetrics() *WorkerPoolMetrics {
	return NewWorkerPoolMetricsWithRegistry(prometheus.DefaultRegisterer)
}

// NewWorkerPoolMetricsWithRegistry creates metrics with a custom registry (for testing).
func NewWorkerPoolMetricsWithRegistry(reg prometheus.Registerer) *WorkerPoolMetrics {
	m := &WorkerPoolMetrics{
		jobsProcessed: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "vocnet_pipeline_jobs_processed_total",
				Help: "Total number of pipeline jobs processed",
			},
			[]string{"status"},
		),
		jobDuration: prometheus.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "vocnet_pipeline_job_duration_seconds",
				Help:    "Duration of pipeline job processing in seconds",
				Buckets: prometheus.ExponentialBuckets(0.1, 2, 10),
			},
		),
		jobsPerMinute: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_jobs_per_minute",
				Help: "Current rate of jobs per minute (1-min window)",
			},
		),
		uptime: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_uptime_seconds",
				Help: "Worker pool uptime in seconds",
			},
		),
		startTime:       time.Now(),
		recentJobs:      make([]jobRecord, 0, 1000),
		recentJobsMutex: make(chan struct{}, 1),
	}

	if reg != nil {
		reg.MustRegister(m.jobsProcessed)
		reg.MustRegister(m.jobDuration)
		reg.MustRegister(m.jobsPerMinute)
		reg.MustRegister(m.uptime)
	}

	return m
}

// RecordJob records a completed job.
func (m *WorkerPoolMetrics) RecordJob(duration time.Duration, succeeded bool) {
	m.processed.Add(1)

	status := "succeeded"
	if succeeded {
		m.succeeded.Add(1)
	} else {
		m.failed.Add(1)
		status = "failed"
	}

	// Update Prometheus metrics
	m.jobsProcessed.WithLabelValues(status).Inc()
	m.jobDuration.Observe(duration.Seconds())

	// Track for rate calculation
	record := jobRecord{
		timestamp:  time.Now(),
		durationNs: duration.Nanoseconds(),
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

	// Update rate gauge
	m.updateRateGauge()
}

// updateRateGauge updates the jobs per minute gauge.
func (m *WorkerPoolMetrics) updateRateGauge() {
	now := time.Now()
	cutoff1min := now.Add(-1 * time.Minute)

	var count1min int64
	for _, r := range m.recentJobs {
		if r.timestamp.After(cutoff1min) {
			count1min++
		}
	}

	m.jobsPerMinute.Set(float64(count1min))
	m.uptime.Set(now.Sub(m.startTime).Seconds())
}

// MetricsSnapshot is a point-in-time snapshot of metrics for CLI display.
type MetricsSnapshot struct {
	UptimeSeconds       float64 `json:"uptime_seconds"`
	JobsProcessed       int64   `json:"jobs_processed"`
	JobsSucceeded       int64   `json:"jobs_succeeded"`
	JobsFailed          int64   `json:"jobs_failed"`
	JobsPerMinute       float64 `json:"jobs_per_minute"`
	AvgDurationMs       float64 `json:"avg_duration_ms"`
	RecentJobsPerMinute float64 `json:"recent_jobs_per_minute"`
	RecentAvgDurationMs float64 `json:"recent_avg_duration_ms"`
}

// Snapshot returns current metrics for CLI display.
func (m *WorkerPoolMetrics) Snapshot() MetricsSnapshot {
	now := time.Now()
	processed := m.processed.Load()
	succeeded := m.succeeded.Load()
	failed := m.failed.Load()

	snapshot := MetricsSnapshot{
		UptimeSeconds: now.Sub(m.startTime).Seconds(),
		JobsProcessed: processed,
		JobsSucceeded: succeeded,
		JobsFailed:    failed,
	}

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
			snapshot.AvgDurationMs = float64(duration5min) / float64(count5min) / 1e6
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
	m.processed.Store(0)
	m.succeeded.Store(0)
	m.failed.Store(0)
	m.startTime = time.Now()

	m.recentJobsMutex <- struct{}{}
	m.recentJobs = make([]jobRecord, 0, 1000)
	<-m.recentJobsMutex

	m.jobsPerMinute.Set(0)
	m.uptime.Set(0)
}

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
	pendingJobs   prometheus.Gauge
	inFlightJobs  prometheus.Gauge
	queueTotal    prometheus.Gauge
	utilization   prometheus.Gauge
	successRate1m prometheus.Gauge
	errorRate1m   prometheus.Gauge
	uptime        prometheus.Gauge

	// Internal tracking for rate calculation
	startTime       time.Time
	recentJobs      []jobRecord
	recentJobsMutex chan struct{}

	// Atomic counters for snapshot
	processed atomic.Int64
	succeeded atomic.Int64
	failed    atomic.Int64
	pending   atomic.Int64
	inFlight  atomic.Int64
	workers   atomic.Int64
}

type jobRecord struct {
	timestamp  time.Time
	durationNs int64
	succeeded  bool
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
		pendingJobs: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_pending_jobs",
				Help: "Number of pending jobs in queue",
			},
		),
		inFlightJobs: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_in_flight_jobs",
				Help: "Number of jobs currently running or queued in workerpool",
			},
		),
		queueTotal: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_queue_total",
				Help: "Total queue depth including pending and in-flight jobs",
			},
		),
		utilization: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_worker_utilization",
				Help: "Current worker utilization ratio in [0,1]",
			},
		),
		successRate1m: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_success_rate_1m",
				Help: "Success ratio over the last 1 minute in [0,1]",
			},
		),
		errorRate1m: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_error_rate_1m",
				Help: "Failure ratio over the last 1 minute in [0,1]",
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
		reg.MustRegister(m.pendingJobs)
		reg.MustRegister(m.inFlightJobs)
		reg.MustRegister(m.queueTotal)
		reg.MustRegister(m.utilization)
		reg.MustRegister(m.successRate1m)
		reg.MustRegister(m.errorRate1m)
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

	// Update rate gauge
	m.updateRateGauge()
}

// updateRateGauge updates the jobs per minute gauge.
func (m *WorkerPoolMetrics) updateRateGauge() {
	now := time.Now()
	cutoff1min := now.Add(-1 * time.Minute)

	var count1min, success1min, failed1min int64
	for _, r := range m.recentJobs {
		if r.timestamp.After(cutoff1min) {
			count1min++
			if r.succeeded {
				success1min++
			} else {
				failed1min++
			}
		}
	}

	m.jobsPerMinute.Set(float64(count1min))
	if count1min > 0 {
		m.successRate1m.Set(float64(success1min) / float64(count1min))
		m.errorRate1m.Set(float64(failed1min) / float64(count1min))
	} else {
		m.successRate1m.Set(0)
		m.errorRate1m.Set(0)
	}
	m.uptime.Set(now.Sub(m.startTime).Seconds())
}

// SetPendingJobs updates the pending jobs count.
func (m *WorkerPoolMetrics) SetPendingJobs(count int64) {
	m.pending.Store(count)
	m.pendingJobs.Set(float64(count))
	m.queueTotal.Set(float64(count + m.inFlight.Load()))
}

// SetInFlightJobs updates in-flight jobs and worker utilization.
func (m *WorkerPoolMetrics) SetInFlightJobs(count int64, workerCount int) {
	m.inFlight.Store(count)
	m.workers.Store(int64(workerCount))
	m.inFlightJobs.Set(float64(count))
	m.queueTotal.Set(float64(count + m.pending.Load()))

	if workerCount <= 0 {
		m.utilization.Set(0)
		return
	}

	ratio := float64(count) / float64(workerCount)
	if ratio > 1 {
		ratio = 1
	}
	if ratio < 0 {
		ratio = 0
	}
	m.utilization.Set(ratio)
}

// MetricsSnapshot is a point-in-time snapshot of metrics for CLI display.
type MetricsSnapshot struct {
	UptimeSeconds       float64 `json:"uptime_seconds"`
	JobsProcessed       int64   `json:"jobs_processed"`
	JobsSucceeded       int64   `json:"jobs_succeeded"`
	JobsFailed          int64   `json:"jobs_failed"`
	PendingJobs         int64   `json:"pending_jobs"`
	JobsPerMinute       float64 `json:"jobs_per_minute"`
	AvgDurationMs       float64 `json:"avg_duration_ms"`
	RecentJobsPerMinute float64 `json:"recent_jobs_per_minute"`
	RecentAvgDurationMs float64 `json:"recent_avg_duration_ms"`
	RecentSucceeded1m   int64   `json:"recent_succeeded_1m"`
	RecentFailed1m      int64   `json:"recent_failed_1m"`
	SuccessRate1m       float64 `json:"success_rate_1m"`
	ErrorRate1m         float64 `json:"error_rate_1m"`
	InFlightJobs        int64   `json:"in_flight_jobs"`
	QueueTotal          int64   `json:"queue_total"`
	WorkerUtilization   float64 `json:"worker_utilization"`
}

// Snapshot returns current metrics for CLI display.
func (m *WorkerPoolMetrics) Snapshot() MetricsSnapshot {
	now := time.Now()
	processed := m.processed.Load()
	succeeded := m.succeeded.Load()
	failed := m.failed.Load()
	pending := m.pending.Load()
	inFlight := m.inFlight.Load()
	workerCount := m.workers.Load()

	snapshot := MetricsSnapshot{
		UptimeSeconds: now.Sub(m.startTime).Seconds(),
		JobsProcessed: processed,
		JobsSucceeded: succeeded,
		JobsFailed:    failed,
		PendingJobs:   pending,
		InFlightJobs:  inFlight,
		QueueTotal:    pending + inFlight,
	}

	m.recentJobsMutex <- struct{}{}
	defer func() { <-m.recentJobsMutex }()

	if len(m.recentJobs) > 0 {
		cutoff5min := now.Add(-5 * time.Minute)
		cutoff1min := now.Add(-1 * time.Minute)

		var count5min, count1min int64
		var success1min, failed1min int64
		var duration5min, duration1min int64

		for _, r := range m.recentJobs {
			if r.timestamp.After(cutoff5min) {
				count5min++
				duration5min += r.durationNs
			}
			if r.timestamp.After(cutoff1min) {
				count1min++
				duration1min += r.durationNs
				if r.succeeded {
					success1min++
				} else {
					failed1min++
				}
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
			snapshot.RecentSucceeded1m = success1min
			snapshot.RecentFailed1m = failed1min
			snapshot.SuccessRate1m = float64(success1min) / float64(count1min)
			snapshot.ErrorRate1m = float64(failed1min) / float64(count1min)
		}
	}

	if workerCount > 0 && snapshot.InFlightJobs > 0 {
		snapshot.WorkerUtilization = float64(snapshot.InFlightJobs) / float64(workerCount)
		if snapshot.WorkerUtilization > 1 {
			snapshot.WorkerUtilization = 1
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
	m.pendingJobs.Set(0)
	m.inFlightJobs.Set(0)
	m.queueTotal.Set(0)
	m.utilization.Set(0)
	m.successRate1m.Set(0)
	m.errorRate1m.Set(0)
	m.uptime.Set(0)
}

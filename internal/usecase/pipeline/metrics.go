package pipeline

import (
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// PrometheusMetrics implements the Metrics interface using Prometheus.
type PrometheusMetrics struct {
	uptimeSeconds     prometheus.Gauge
	jobsProcessed     *prometheus.CounterVec
	pendingJobs       prometheus.Gauge
	inFlightJobs      prometheus.Gauge
	queueTotal        prometheus.Gauge
	workerUtilization prometheus.Gauge
	jobsPerMinute     prometheus.Gauge
	successRate1m     prometheus.Gauge
	errorRate1m       prometheus.Gauge
	jobDuration       prometheus.Histogram

	// Helper for rate calculation
	startTime time.Time
	mu        sync.Mutex
	history   []jobResult

	// Internal state
	pendingCount  int64
	inFlightCount int64
}

type jobResult struct {
	timestamp time.Time
	succeeded bool
}

// NewPrometheusMetrics creates and registers pipeline metrics.
func NewPrometheusMetrics() *PrometheusMetrics {
	m := &PrometheusMetrics{
		startTime: time.Now(),
		uptimeSeconds: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "vocnet_pipeline_uptime_seconds",
			Help: "Number of seconds since the pipeline started",
		}),
		jobsProcessed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "vocnet_pipeline_jobs_processed_total",
			Help: "Total number of jobs processed by the pipeline",
		}, []string{"status"}),
		pendingJobs: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "vocnet_pipeline_pending_jobs",
			Help: "Number of jobs currently in the queue",
		}),
		inFlightJobs: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "vocnet_pipeline_in_flight_jobs",
			Help: "Number of jobs currently being processed",
		}),
		queueTotal: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "vocnet_pipeline_queue_total",
			Help: "Total number of jobs in queue (pending + in-flight)",
		}),
		workerUtilization: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "vocnet_pipeline_worker_utilization",
			Help: "Percentage of workers currently active",
		}),
		jobsPerMinute: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "vocnet_pipeline_jobs_per_minute",
			Help: "Number of jobs processed per minute",
		}),
		successRate1m: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "vocnet_pipeline_success_rate_1m",
			Help: "Percentage of jobs that succeeded in the last 1 minute",
		}),
		errorRate1m: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "vocnet_pipeline_error_rate_1m",
			Help: "Percentage of jobs that failed in the last 1 minute",
		}),
		jobDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "vocnet_pipeline_job_duration_seconds",
			Help:    "Pipeline job processing duration in seconds",
			Buckets: prometheus.ExponentialBuckets(0.1, 2, 10),
		}),
	}

	// Register all metrics
	prometheus.MustRegister(m.uptimeSeconds)
	prometheus.MustRegister(m.jobsProcessed)
	prometheus.MustRegister(m.pendingJobs)
	prometheus.MustRegister(m.inFlightJobs)
	prometheus.MustRegister(m.queueTotal)
	prometheus.MustRegister(m.workerUtilization)
	prometheus.MustRegister(m.jobsPerMinute)
	prometheus.MustRegister(m.successRate1m)
	prometheus.MustRegister(m.errorRate1m)
	prometheus.MustRegister(m.jobDuration)

	// Start background trackers
	go m.trackUptime()
	go m.trackRates()

	return m
}

func (m *PrometheusMetrics) trackUptime() {
	ticker := time.NewTicker(5 * time.Second)
	for range ticker.C {
		m.uptimeSeconds.Set(time.Since(m.startTime).Seconds())
	}
}

func (m *PrometheusMetrics) trackRates() {
	ticker := time.NewTicker(10 * time.Second)
	for range ticker.C {
		m.mu.Lock()
		now := time.Now()
		minuteAgo := now.Add(-1 * time.Minute)

		// Clean up old history
		var filtered []jobResult
		var succeeded, failed float64
		for _, res := range m.history {
			if res.timestamp.After(minuteAgo) {
				filtered = append(filtered, res)
				if res.succeeded {
					succeeded++
				} else {
					failed++
				}
			}
		}
		m.history = filtered
		m.mu.Unlock()

		total := succeeded + failed
		if total > 0 {
			m.successRate1m.Set(succeeded / total)
			m.errorRate1m.Set(failed / total)
			m.jobsPerMinute.Set(total)
		} else {
			m.successRate1m.Set(0)
			m.errorRate1m.Set(0)
			m.jobsPerMinute.Set(0)
		}
	}
}

func (m *PrometheusMetrics) RecordJob(duration time.Duration, succeeded bool) {
	status := "succeeded"
	if !succeeded {
		status = "failed"
	}
	m.jobsProcessed.WithLabelValues(status).Inc()
	m.jobDuration.Observe(duration.Seconds())

	m.mu.Lock()
	m.history = append(m.history, jobResult{
		timestamp: time.Now(),
		succeeded: succeeded,
	})
	m.mu.Unlock()
}

func (m *PrometheusMetrics) SetPendingJobs(count int64) {
	m.mu.Lock()
	m.pendingCount = count
	m.mu.Unlock()

	m.pendingJobs.Set(float64(count))
	m.updateQueueTotal()
}

func (m *PrometheusMetrics) SetInFlightJobs(count int64, workerCount int) {
	m.mu.Lock()
	m.inFlightCount = count
	m.mu.Unlock()

	m.inFlightJobs.Set(float64(count))
	if workerCount > 0 {
		m.workerUtilization.Set(float64(count) / float64(workerCount))
	}
	m.updateQueueTotal()
}

func (m *PrometheusMetrics) updateQueueTotal() {
	m.mu.Lock()
	total := m.pendingCount + m.inFlightCount
	m.mu.Unlock()
	m.queueTotal.Set(float64(total))
}

package server

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// PipelineMetrics holds Prometheus metrics for the pipeline worker pool.
type PipelineMetrics struct {
	JobsProcessed *prometheus.CounterVec
	JobsTotal     *prometheus.GaugeVec
	JobDuration   prometheus.Histogram
	JobsPerMinute prometheus.Gauge
	Uptime        prometheus.Gauge
}

// NewPipelineMetrics creates and registers pipeline metrics.
func NewPipelineMetrics(reg prometheus.Registerer) *PipelineMetrics {
	m := &PipelineMetrics{
		JobsProcessed: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "vocnet_pipeline_jobs_processed_total",
				Help: "Total number of pipeline jobs processed",
			},
			[]string{"status"}, // "succeeded" or "failed"
		),
		JobsTotal: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_queue_jobs",
				Help: "Number of jobs in queue by status",
			},
			[]string{"status"}, // "pending", "running", "completed", "failed", "paused", "cancelled"
		),
		JobDuration: prometheus.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "vocnet_pipeline_job_duration_seconds",
				Help:    "Duration of pipeline job processing in seconds",
				Buckets: prometheus.ExponentialBuckets(0.1, 2, 10), // 0.1s to ~100s
			},
		),
		JobsPerMinute: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_jobs_per_minute",
				Help: "Current rate of jobs per minute (1-min window)",
			},
		),
		Uptime: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "vocnet_pipeline_uptime_seconds",
				Help: "Worker pool uptime in seconds",
			},
		),
	}

	reg.MustRegister(m.JobsProcessed)
	reg.MustRegister(m.JobsTotal)
	reg.MustRegister(m.JobDuration)
	reg.MustRegister(m.JobsPerMinute)
	reg.MustRegister(m.Uptime)

	return m
}

// MetricsHandler returns an http.Handler for the /metrics endpoint.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

// MetricsHandlerFor returns an http.Handler for a custom registry.
func MetricsHandlerFor(reg *prometheus.Registry) http.Handler {
	return promhttp.HandlerFor(reg, promhttp.HandlerOpts{})
}

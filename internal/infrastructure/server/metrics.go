package server

import (
	"encoding/json"
	"net/http"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
)

// PipelineMetricsProvider provides metrics from the pipeline worker pool.
type PipelineMetricsProvider interface {
	Metrics() pipeline.MetricsSnapshot
}

// PipelineStatsResponse is the full stats response including queue info.
type PipelineStatsResponse struct {
	// Worker pool metrics
	Worker pipeline.MetricsSnapshot `json:"worker"`

	// Queue status (from database)
	Queue QueueStats `json:"queue"`

	// Estimated time remaining
	EstimatedRemainingSeconds float64 `json:"estimated_remaining_seconds,omitempty"`
}

// QueueStats contains job queue statistics.
type QueueStats struct {
	Pending   int64 `json:"pending"`
	Running   int64 `json:"running"`
	Completed int64 `json:"completed"`
	Failed    int64 `json:"failed"`
	Paused    int64 `json:"paused"`
	Cancelled int64 `json:"cancelled"`
	Total     int64 `json:"total"`
}

// MetricsHandler handles the /metrics/pipeline endpoint.
type MetricsHandler struct {
	metricsProvider PipelineMetricsProvider
	jobRepo         repository.PipelineJobRepository
}

// NewMetricsHandler creates a new metrics handler.
func NewMetricsHandler(provider PipelineMetricsProvider, jobRepo repository.PipelineJobRepository) *MetricsHandler {
	return &MetricsHandler{
		metricsProvider: provider,
		jobRepo:         jobRepo,
	}
}

// ServeHTTP handles metrics requests.
func (h *MetricsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	// Get worker metrics
	var workerMetrics pipeline.MetricsSnapshot
	if h.metricsProvider != nil {
		workerMetrics = h.metricsProvider.Metrics()
	}

	// Get queue stats from database
	queueStats := QueueStats{}
	if h.jobRepo != nil {
		statuses := []entity.JobStatus{
			entity.JobStatusPending,
			entity.JobStatusRunning,
			entity.JobStatusCompleted,
			entity.JobStatusFailed,
			entity.JobStatusPaused,
			entity.JobStatusCancelled,
		}

		for _, status := range statuses {
			s := status
			jobs, err := h.jobRepo.List(ctx, &s, 0) // 0 = no limit, just count
			if err != nil {
				continue
			}
			count := int64(len(jobs))
			queueStats.Total += count

			switch status {
			case entity.JobStatusPending:
				queueStats.Pending = count
			case entity.JobStatusRunning:
				queueStats.Running = count
			case entity.JobStatusCompleted:
				queueStats.Completed = count
			case entity.JobStatusFailed:
				queueStats.Failed = count
			case entity.JobStatusPaused:
				queueStats.Paused = count
			case entity.JobStatusCancelled:
				queueStats.Cancelled = count
			}
		}
	}

	// Calculate estimated remaining time
	var estimatedRemaining float64
	remaining := queueStats.Pending + queueStats.Running
	if remaining > 0 && workerMetrics.RecentJobsPerMinute > 0 {
		estimatedRemaining = float64(remaining) / workerMetrics.RecentJobsPerMinute * 60 // convert to seconds
	}

	response := PipelineStatsResponse{
		Worker:                    workerMetrics,
		Queue:                     queueStats,
		EstimatedRemainingSeconds: estimatedRemaining,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

package server

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// MetricsHandler returns an http.Handler for the /metrics endpoint.
// Metrics are registered by pipeline.WorkerPoolMetrics to the default registry.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

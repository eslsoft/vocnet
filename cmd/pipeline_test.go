package cmd

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParsePipelineStats(t *testing.T) {
	// Sample Prometheus output
	metrics := `
# HELP vocnet_pipeline_uptime_seconds Gauge
# TYPE vocnet_pipeline_uptime_seconds gauge
vocnet_pipeline_uptime_seconds 3600

# HELP vocnet_pipeline_jobs_per_minute Gauge
# TYPE vocnet_pipeline_jobs_per_minute gauge
vocnet_pipeline_jobs_per_minute 12.5

# HELP vocnet_pipeline_jobs_processed_total Counter
# TYPE vocnet_pipeline_jobs_processed_total counter
vocnet_pipeline_jobs_processed_total{status="succeeded"} 100
vocnet_pipeline_jobs_processed_total{status="failed"} 5

# HELP vocnet_pipeline_job_duration_seconds Histogram
# TYPE vocnet_pipeline_job_duration_seconds histogram
vocnet_pipeline_job_duration_seconds_bucket{le="0.1"} 10
vocnet_pipeline_job_duration_seconds_sum 50.0
vocnet_pipeline_job_duration_seconds_count 105
`

	stats, err := parsePipelineStats(strings.NewReader(metrics))
	assert.NoError(t, err)
	assert.NotNil(t, stats)

	assert.Equal(t, 3600.0, stats.UptimeSeconds)
	assert.Equal(t, 12.5, stats.JobsPerMinute)
	assert.Equal(t, 100.0, stats.JobsSucceeded)
	assert.Equal(t, 5.0, stats.JobsFailed)
	assert.Equal(t, 50.0, stats.JobDurationSum)
	assert.Equal(t, 105.0, stats.JobDurationCount)
}

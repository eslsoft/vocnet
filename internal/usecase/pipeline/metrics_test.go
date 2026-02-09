package pipeline

import (
	"testing"
	"time"
)

func TestWorkerPoolMetrics_RecordJob(t *testing.T) {
	m := NewWorkerPoolMetrics()

	// Record some successful jobs
	m.RecordJob(100*time.Millisecond, true)
	m.RecordJob(200*time.Millisecond, true)
	m.RecordJob(150*time.Millisecond, false)

	snapshot := m.Snapshot()

	if snapshot.JobsProcessed != 3 {
		t.Errorf("expected 3 processed jobs, got %d", snapshot.JobsProcessed)
	}
	if snapshot.JobsSucceeded != 2 {
		t.Errorf("expected 2 succeeded jobs, got %d", snapshot.JobsSucceeded)
	}
	if snapshot.JobsFailed != 1 {
		t.Errorf("expected 1 failed job, got %d", snapshot.JobsFailed)
	}

	// Average should be (100+200+150)/3 = 150ms
	expectedAvg := 150.0
	if snapshot.AvgDurationMs < expectedAvg-1 || snapshot.AvgDurationMs > expectedAvg+1 {
		t.Errorf("expected avg duration ~%.0f ms, got %.0f ms", expectedAvg, snapshot.AvgDurationMs)
	}

	if snapshot.UptimeSeconds <= 0 {
		t.Error("expected positive uptime")
	}
}

func TestWorkerPoolMetrics_RateCalculation(t *testing.T) {
	m := NewWorkerPoolMetrics()

	// Record 10 jobs quickly
	for range 10 {
		m.RecordJob(50*time.Millisecond, true)
	}

	snapshot := m.Snapshot()

	// Jobs per minute should be > 0 since we just recorded jobs
	if snapshot.RecentJobsPerMinute <= 0 {
		t.Errorf("expected positive recent rate, got %.2f", snapshot.RecentJobsPerMinute)
	}

	// Should equal 10 since all were recorded in the last minute
	if snapshot.RecentJobsPerMinute != 10 {
		t.Errorf("expected recent rate of 10 jobs/min, got %.2f", snapshot.RecentJobsPerMinute)
	}
}

func TestWorkerPoolMetrics_Reset(t *testing.T) {
	m := NewWorkerPoolMetrics()

	m.RecordJob(100*time.Millisecond, true)
	m.RecordJob(100*time.Millisecond, false)

	m.Reset()

	snapshot := m.Snapshot()

	if snapshot.JobsProcessed != 0 {
		t.Errorf("expected 0 processed jobs after reset, got %d", snapshot.JobsProcessed)
	}
	if snapshot.JobsSucceeded != 0 {
		t.Errorf("expected 0 succeeded jobs after reset, got %d", snapshot.JobsSucceeded)
	}
	if snapshot.JobsFailed != 0 {
		t.Errorf("expected 0 failed jobs after reset, got %d", snapshot.JobsFailed)
	}
}

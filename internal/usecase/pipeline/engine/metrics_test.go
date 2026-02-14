package engine

import (
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

func TestWorkerPoolMetrics_RecordJob(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := NewWorkerPoolMetricsWithRegistry(reg)

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
	reg := prometheus.NewRegistry()
	m := NewWorkerPoolMetricsWithRegistry(reg)

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
	reg := prometheus.NewRegistry()
	m := NewWorkerPoolMetricsWithRegistry(reg)

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

func TestWorkerPoolMetrics_PendingJobs(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := NewWorkerPoolMetricsWithRegistry(reg)

	m.SetPendingJobs(42)

	snapshot := m.Snapshot()
	if snapshot.PendingJobs != 42 {
		t.Errorf("expected 42 pending jobs, got %d", snapshot.PendingJobs)
	}

	m.SetPendingJobs(0)
	snapshot = m.Snapshot()
	if snapshot.PendingJobs != 0 {
		t.Errorf("expected 0 pending jobs, got %d", snapshot.PendingJobs)
	}
}

func TestWorkerPoolMetrics_InFlightAndUtilization(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := NewWorkerPoolMetricsWithRegistry(reg)

	m.SetPendingJobs(3)
	m.SetInFlightJobs(2, 4)

	snapshot := m.Snapshot()
	if snapshot.InFlightJobs != 2 {
		t.Errorf("expected 2 in-flight jobs, got %d", snapshot.InFlightJobs)
	}
	if snapshot.QueueTotal != 5 {
		t.Errorf("expected queue total 5, got %d", snapshot.QueueTotal)
	}
	if snapshot.WorkerUtilization < 0.49 || snapshot.WorkerUtilization > 0.51 {
		t.Errorf("expected utilization ~0.5, got %.2f", snapshot.WorkerUtilization)
	}
}

func TestWorkerPoolMetrics_RecentSuccessAndErrorRate(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := NewWorkerPoolMetricsWithRegistry(reg)

	m.RecordJob(100*time.Millisecond, true)
	m.RecordJob(120*time.Millisecond, true)
	m.RecordJob(80*time.Millisecond, false)
	m.RecordJob(90*time.Millisecond, false)

	snapshot := m.Snapshot()
	if snapshot.RecentSucceeded1m != 2 {
		t.Errorf("expected 2 recent succeeded jobs, got %d", snapshot.RecentSucceeded1m)
	}
	if snapshot.RecentFailed1m != 2 {
		t.Errorf("expected 2 recent failed jobs, got %d", snapshot.RecentFailed1m)
	}
	if snapshot.SuccessRate1m < 0.49 || snapshot.SuccessRate1m > 0.51 {
		t.Errorf("expected success rate ~0.5, got %.2f", snapshot.SuccessRate1m)
	}
	if snapshot.ErrorRate1m < 0.49 || snapshot.ErrorRate1m > 0.51 {
		t.Errorf("expected error rate ~0.5, got %.2f", snapshot.ErrorRate1m)
	}
}

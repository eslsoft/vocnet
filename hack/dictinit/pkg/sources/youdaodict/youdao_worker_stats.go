package youdaodict

import (
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
)

type workerStats struct {
	succeeded           int64
	failed              int64
	skipped             int64
	notFound            int64
	totalPhoneticsAdded int64
	totalSensesAdded    int64
	successSamples      []report.SampleEntry
	failureSamples      []report.SampleEntry
}

func newWorkerStats() workerStats {
	return workerStats{
		successSamples: make([]report.SampleEntry, 0),
		failureSamples: make([]report.SampleEntry, 0),
	}
}

type enrichmentResult struct {
	term           string
	succeeded      bool
	notFound       bool
	skipped        bool
	phoneticsAdded int
	sensesAdded    int
	err            error
}

func (s *workerStats) applyResult(res enrichmentResult) {
	if res.err != nil {
		s.failed++
		if len(s.failureSamples) < 10 {
			s.failureSamples = append(s.failureSamples, report.SampleEntry{
				Term:   res.term,
				Reason: res.err.Error(),
			})
		}
		return
	}

	if res.notFound {
		s.notFound++
		s.skipped++
		return
	}

	if res.skipped {
		s.skipped++
		return
	}

	if res.succeeded {
		s.succeeded++
		s.totalPhoneticsAdded += int64(res.phoneticsAdded)
		s.totalSensesAdded += int64(res.sensesAdded)

		if len(s.successSamples) < 10 {
			s.successSamples = append(s.successSamples, report.SampleEntry{
				Term:          res.term,
				HasPhonetic:   res.phoneticsAdded > 0,
				HasDefinition: res.sensesAdded > 0,
			})
		}
	}
}

func (s *workerStats) merge(other workerStats) {
	s.succeeded += other.succeeded
	s.failed += other.failed
	s.skipped += other.skipped
	s.notFound += other.notFound
	s.totalPhoneticsAdded += other.totalPhoneticsAdded
	s.totalSensesAdded += other.totalSensesAdded

	if len(s.successSamples) < 10 {
		s.successSamples = append(s.successSamples, other.successSamples...)
		if len(s.successSamples) > 10 {
			s.successSamples = s.successSamples[:10]
		}
	}
	if len(s.failureSamples) < 10 {
		s.failureSamples = append(s.failureSamples, other.failureSamples...)
		if len(s.failureSamples) > 10 {
			s.failureSamples = s.failureSamples[:10]
		}
	}
}

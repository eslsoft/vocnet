package ecdict

import (
	"log"

	reportpkg "github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
)

type ecdictWorkerStats struct {
	succeeded           int64
	failed              int64
	notFound            int64
	totalPhoneticsAdded int64
	totalSensesAdded    int64
	totalFormsAdded     int64
	successSamples      []reportpkg.SampleEntry
	failureSamples      []reportpkg.SampleEntry
}

func newECDictWorkerStats() ecdictWorkerStats {
	return ecdictWorkerStats{
		successSamples: make([]reportpkg.SampleEntry, 0, 10),
		failureSamples: make([]reportpkg.SampleEntry, 0, 10),
	}
}

func (s *ecdictWorkerStats) applyResult(result ecdictEnrichmentResult) {
	switch {
	case result.err != nil:
		s.failed++
		if len(s.failureSamples) < 10 {
			s.failureSamples = append(s.failureSamples, reportpkg.SampleEntry{
				Term:    result.word,
				Reason:  "enrich_error",
				Details: result.err.Error(),
			})
		}
		log.Printf("[ecdict-enrich] failed to enrich %s: %v", result.word, result.err)
	case result.notFound:
		s.notFound++
	case result.succeeded:
		s.succeeded++
		s.totalPhoneticsAdded += int64(result.phoneticsAdded)
		s.totalSensesAdded += int64(result.sensesAdded)
		s.totalFormsAdded += int64(result.formsAdded)
		if len(s.successSamples) < 10 {
			s.successSamples = append(s.successSamples, reportpkg.SampleEntry{
				Term:          result.word,
				HasPhonetic:   result.phoneticsAdded > 0,
				HasDefinition: result.sensesAdded > 0,
			})
		}
	}
}

func (s *ecdictWorkerStats) merge(other ecdictWorkerStats) {
	s.succeeded += other.succeeded
	s.failed += other.failed
	s.notFound += other.notFound
	s.totalPhoneticsAdded += other.totalPhoneticsAdded
	s.totalSensesAdded += other.totalSensesAdded
	s.totalFormsAdded += other.totalFormsAdded
	s.successSamples = appendSamples(s.successSamples, other.successSamples, 10)
	s.failureSamples = appendSamples(s.failureSamples, other.failureSamples, 10)
}

func appendSamples(dst, src []reportpkg.SampleEntry, max int) []reportpkg.SampleEntry {
	remaining := max - len(dst)
	if remaining <= 0 || len(src) == 0 {
		return dst
	}
	if len(src) <= remaining {
		return append(dst, src...)
	}
	return append(dst, src[:remaining]...)
}

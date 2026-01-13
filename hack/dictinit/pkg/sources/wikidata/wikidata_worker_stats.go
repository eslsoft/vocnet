package wikidata

import (
	"log"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

const relationTypeCountSize = int(dictv1.RelationType_RELATION_TYPE_PART_WHOLE) + 1

type wikidataWorkerStats struct {
	succeeded          int64
	failed             int64
	skipped            int64
	totalForms         int64
	regularForms       int64
	irregularForms     int64
	totalRelations     int64
	totalCategories    int64
	withPhonetics      int64
	withDefinitions    int64
	relationTypeCounts []int64
	successSamples     []report.SampleEntry
	failureSamples     []report.SampleEntry
	skippedSamples     []report.SampleEntry
}

func newWikidataWorkerStats() wikidataWorkerStats {
	return wikidataWorkerStats{
		relationTypeCounts: make([]int64, relationTypeCountSize),
		successSamples:     make([]report.SampleEntry, 0, 10),
		failureSamples:     make([]report.SampleEntry, 0, 10),
		skippedSamples:     make([]report.SampleEntry, 0, 10),
	}
}

func (s *wikidataWorkerStats) applyResult(result importResult) {
	switch {
	case result.err != nil:
		s.failed++
		if len(s.failureSamples) < 10 {
			s.failureSamples = append(s.failureSamples, report.SampleEntry{
				Term:    result.lemma,
				Reason:  "import_error",
				Details: result.err.Error(),
			})
		}
		log.Printf("[wikidata] failed to import %s (%s): %v", result.id, result.lemma, result.err)
		util.Warn("[wikidata] failed to import %s: %v", result.lemma, result.err)
	case result.skipped:
		s.skipped++
		if len(s.skippedSamples) < 10 {
			s.skippedSamples = append(s.skippedSamples, report.SampleEntry{
				Term:   result.id,
				Reason: result.skipReason,
			})
		}
	default:
		s.succeeded++
		if len(s.successSamples) < 10 {
			s.successSamples = append(s.successSamples, report.SampleEntry{
				Term:          result.lemma,
				Forms:         result.forms,
				HasPhonetic:   result.hasPhonetic,
				HasDefinition: result.hasDefinitions,
			})
		}

		s.totalForms += int64(result.formCount)
		s.irregularForms += int64(result.irregularCount)
		s.regularForms += int64(result.formCount - result.irregularCount)

		if result.relationsCount > 0 {
			s.totalRelations += int64(result.relationsCount)
			for idx, count := range result.relationTypes {
				if count == 0 {
					continue
				}
				if idx >= len(s.relationTypeCounts) {
					expanded := make([]int64, idx+1)
					copy(expanded, s.relationTypeCounts)
					s.relationTypeCounts = expanded
				}
				s.relationTypeCounts[idx] += count
			}
		}
		if result.categoriesCount > 0 {
			s.totalCategories += int64(result.categoriesCount)
		}
		if result.hasPhonetic {
			s.withPhonetics++
		}
		if result.hasDefinitions {
			s.withDefinitions++
		}
	}
}

func (s *wikidataWorkerStats) merge(other wikidataWorkerStats) {
	s.succeeded += other.succeeded
	s.failed += other.failed
	s.skipped += other.skipped
	s.totalForms += other.totalForms
	s.regularForms += other.regularForms
	s.irregularForms += other.irregularForms
	s.totalRelations += other.totalRelations
	s.totalCategories += other.totalCategories
	s.withPhonetics += other.withPhonetics
	s.withDefinitions += other.withDefinitions
	if len(other.relationTypeCounts) > len(s.relationTypeCounts) {
		expanded := make([]int64, len(other.relationTypeCounts))
		copy(expanded, s.relationTypeCounts)
		s.relationTypeCounts = expanded
	}
	for idx, count := range other.relationTypeCounts {
		s.relationTypeCounts[idx] += count
	}
	s.successSamples = appendSamples(s.successSamples, other.successSamples, 10)
	s.failureSamples = appendSamples(s.failureSamples, other.failureSamples, 10)
	s.skippedSamples = appendSamples(s.skippedSamples, other.skippedSamples, 10)
}

func appendSamples(dst, src []report.SampleEntry, max int) []report.SampleEntry {
	remaining := max - len(dst)
	if remaining <= 0 || len(src) == 0 {
		return dst
	}
	if len(src) <= remaining {
		return append(dst, src...)
	}
	return append(dst, src[:remaining]...)
}

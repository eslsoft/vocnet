package ecdict

import (
	"testing"

	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
)

func TestRegisterKnownWords_EnrichmentWithoutExchange(t *testing.T) {
	// Test that words without exchange can be enriched if they're registered as known.
	enricher := &Enricher{
		entries: map[string]*ecdictEnrichment{
			"but": {
				// No exchange, but has useful data
				senses: []sensePayload{{
					language:     commonv1.Language_LANGUAGE_CHINESE,
					partOfSpeech: "conj.",
					gloss:        "但是",
				}},
				translation: "但是",
			},
			"because": {
				// No exchange, but has useful data
				senses: []sensePayload{{
					language:     commonv1.Language_LANGUAGE_CHINESE,
					partOfSpeech: "conj.",
					gloss:        "因为",
				}},
				translation: "因为",
			},
			"run": {
				// Has exchange - should be in newWords if not known
				exchange: "p:ran/d:run/i:running/3:runs",
				senses: []sensePayload{{
					language:     commonv1.Language_LANGUAGE_CHINESE,
					partOfSpeech: "v.",
					gloss:        "跑",
				}},
			},
		},
		knownForms: make(map[string]bool),
	}

	// First, test without registering known words.
	enrichmentWords, skipped := enricher.CollectEnrichmentWords()

	// All words should be skipped because we only enrich existing data.
	if len(enrichmentWords) != 0 {
		t.Errorf("Before registration: enrichmentWords length = %d, want 0", len(enrichmentWords))
	}

	skippedCount := 0
	for _, skip := range skipped {
		if skip.reason == "not_in_db" {
			skippedCount++
		}
	}
	if skippedCount != 3 {
		t.Errorf("Before registration: skipped (not_in_db) count = %d, want 3", skippedCount)
	}

	// Now register "but" and "because" as known words.
	enricher.RegisterKnownForms(map[string]struct{}{
		"but":     {},
		"because": {},
	})

	// Test again after registering.
	enrichmentWords, _ = enricher.CollectEnrichmentWords()

	// Now "but" and "because" should be in enrichmentWords.
	if len(enrichmentWords) != 2 {
		t.Errorf("After registration: enrichmentWords length = %d, want 2 (but, because)", len(enrichmentWords))
	}

	// Verify the enrichment words are correct
	foundBut := false
	foundBecause := false
	for _, word := range enrichmentWords {
		if word.word == "but" {
			foundBut = true
		}
		if word.word == "because" {
			foundBecause = true
		}
	}
	if !foundBut {
		t.Error("'but' not found in enrichmentWords after registration")
	}
	if !foundBecause {
		t.Error("'because' not found in enrichmentWords after registration")
	}
}

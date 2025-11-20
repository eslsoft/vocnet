package main

import (
	"testing"

	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

func TestParseExchange(t *testing.T) {
	tests := []struct {
		name          string
		currentWord   string
		exchange      string
		wantLemma     string
		wantFormLen   int
		wantFormType  map[dictv1.FormType]string
		wantIrregular map[dictv1.FormType]bool
	}{
		{
			name:        "complete verb forms",
			currentWord: "run",
			exchange:    "p:ran/d:run/i:running/3:runs/0:run",
			wantLemma:   "run",
			wantFormLen: 4,
			wantFormType: map[dictv1.FormType]string{
				dictv1.FormType_FORM_TYPE_PAST:                  "ran",
				dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:       "run",
				dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:    "running",
				dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR: "runs",
			},
			wantIrregular: map[dictv1.FormType]bool{
				dictv1.FormType_FORM_TYPE_PAST:                  true,  // ran is irregular
				dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:       true,  // run (same as lemma) is irregular
				dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:    false, // running is regular
				dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR: false, // runs is regular
			},
		},
		{
			name:        "lemma entry without 0 marker",
			currentWord: "perceive",
			exchange:    "d:perceived/p:perceived/3:perceives/i:perceiving",
			wantLemma:   "", // No "0:" means this word IS the lemma
			wantFormLen: 4,  // Should have all forms
			wantFormType: map[dictv1.FormType]string{
				dictv1.FormType_FORM_TYPE_PAST:                  "perceived",
				dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:       "perceived",
				dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:    "perceiving",
				dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR: "perceives",
			},
			wantIrregular: map[dictv1.FormType]bool{
				dictv1.FormType_FORM_TYPE_PAST:                  false, // perceived is regular (perceive + d)
				dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:       false, // perceived is regular
				dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:    false, // perceiving is regular (drop e + ing)
				dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR: false, // perceives is regular
			},
		},
		{
			name:        "perceived with lemma",
			exchange:    "d:perceived/p:perceived/3:perceives/i:perceiving/0:perceive",
			wantLemma:   "perceive",
			wantFormLen: 4,
			wantFormType: map[dictv1.FormType]string{
				dictv1.FormType_FORM_TYPE_PAST:                  "perceived",
				dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:       "perceived",
				dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:    "perceiving",
				dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR: "perceives",
			},
		},
		{
			name:        "adjective forms",
			exchange:    "r:bigger/t:biggest/0:big",
			wantLemma:   "big",
			wantFormLen: 2,
			wantFormType: map[dictv1.FormType]string{
				dictv1.FormType_FORM_TYPE_COMPARATIVE: "bigger",
				dictv1.FormType_FORM_TYPE_SUPERLATIVE: "biggest",
			},
		},
		{
			name:        "noun plural",
			exchange:    "s:cats/0:cat",
			wantLemma:   "cat",
			wantFormLen: 1,
			wantFormType: map[dictv1.FormType]string{
				dictv1.FormType_FORM_TYPE_PLURAL: "cats",
			},
		},
		{
			name:        "no exchange",
			exchange:    "",
			wantLemma:   "",
			wantFormLen: 0,
		},
		{
			name:        "lemma entry for running",
			exchange:    "p:ran/d:run/i:running/3:runs",
			wantLemma:   "", // No "0:" means this word IS the lemma
			wantFormLen: 4,  // Should have all forms
			wantFormType: map[dictv1.FormType]string{
				dictv1.FormType_FORM_TYPE_PAST:                  "ran",
				dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:       "run",
				dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:    "running",
				dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR: "runs",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lemma, forms := parseExchange(tt.currentWord, tt.exchange)

			if lemma != tt.wantLemma {
				t.Errorf("parseExchange() lemma = %q, want %q", lemma, tt.wantLemma)
			}

			if len(forms) != tt.wantFormLen {
				t.Errorf("parseExchange() forms length = %d, want %d", len(forms), tt.wantFormLen)
			}

			if tt.wantFormType != nil {
				gotFormType := make(map[dictv1.FormType]string)
				gotIrregular := make(map[dictv1.FormType]bool)
				for _, form := range forms {
					gotFormType[form.FormType] = form.Term
					gotIrregular[form.FormType] = form.Irregular
				}

				for formType, expectedWord := range tt.wantFormType {
					if gotWord, ok := gotFormType[formType]; !ok {
						t.Errorf("missing form type %v", formType)
					} else if gotWord != expectedWord {
						t.Errorf("form type %v: got word %q, want %q", formType, gotWord, expectedWord)
					}
				}

				// Check irregular flags if specified
				if tt.wantIrregular != nil {
					for formType, expectedIrregular := range tt.wantIrregular {
						if gotIrregular, ok := gotIrregular[formType]; !ok {
							t.Errorf("missing irregular flag for form type %v", formType)
						} else if gotIrregular != expectedIrregular {
							t.Errorf("form type %v: got irregular=%v, want irregular=%v",
								formType, gotIrregular, expectedIrregular)
						}
					}
				}
			}
		})
	}
}

func TestBuildWordFromECDICT(t *testing.T) {
	enrichment := &ecdictEnrichment{
		phonetics: []*dictv1.Phonetic{
			{Ipa: "/rʌn/", Dialect: "en-US"},
		},
		categories: []string{"level:cet4"},
		domains:    []string{"domain:sports"},
		senses: []sensePayload{
			{language: 1, partOfSpeech: "v.", gloss: "跑"},
			{language: 1, partOfSpeech: "v.", gloss: "运转"},
			{language: 1, partOfSpeech: "n.", gloss: "跑步"},
		},
	}

	forms := []*dictv1.RelatedForm{
		{Term: "ran", FormType: dictv1.FormType_FORM_TYPE_PAST},
		{Term: "running", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
	}

	word := buildWordFromECDICT("run", forms, enrichment)

	if word.Term != "run" {
		t.Errorf("Term = %q, want %q", word.Term, "run")
	}

	if word.TermType != dictv1.FormType_FORM_TYPE_LEMMA {
		t.Errorf("TermType = %v, want FORM_TYPE_LEMMA", word.TermType)
	}

	if len(word.RelatedForms) != 2 {
		t.Errorf("RelatedForms length = %d, want 2", len(word.RelatedForms))
	}

	if len(word.Meanings) != 2 {
		t.Errorf("Meanings length = %d, want 2 (verb and noun)", len(word.Meanings))
	}

	posCount := make(map[string]int)
	for _, meaning := range word.Meanings {
		posCount[meaning.GetPos()] = len(meaning.GetDefinitions())
	}

	if posCount["v."] != 2 {
		t.Errorf("verb definitions count = %d, want 2", posCount["v."])
	}
	if posCount["n."] != 1 {
		t.Errorf("noun definitions count = %d, want 1", posCount["n."])
	}

	// Check categories include both categories and domains
	if len(word.Categories) != 2 {
		t.Errorf("Categories length = %d, want 2", len(word.Categories))
	}
}

func TestBuildWordFromECDICT_NoPOS(t *testing.T) {
	enrichment := &ecdictEnrichment{
		senses: []sensePayload{
			{language: 1, partOfSpeech: "", gloss: "释义1"},
			{language: 1, partOfSpeech: "", gloss: "释义2"},
		},
	}

	forms := []*dictv1.RelatedForm{}

	word := buildWordFromECDICT("test", forms, enrichment)

	if len(word.Meanings) != 1 {
		t.Errorf("Meanings length = %d, want 1 (all senses in one meaning)", len(word.Meanings))
	}

	if word.Meanings[0].GetPos() != "" {
		t.Errorf("Meaning POS = %q, want empty", word.Meanings[0].GetPos())
	}

	if len(word.Meanings[0].GetDefinitions()) != 2 {
		t.Errorf("Definitions in meaning = %d, want 2", len(word.Meanings[0].GetDefinitions()))
	}
}

func TestRegisterKnownWords_EnrichmentWithoutExchange(t *testing.T) {
	// Test that words without exchange can be enriched if they're registered as known
	enricher := &ecdictEnricher{
		entries: map[string]*ecdictEnrichment{
			"but": {
				// No exchange, but has useful data
				senses: []sensePayload{
					{
						language:     commonv1.Language_LANGUAGE_CHINESE,
						partOfSpeech: "conj.",
						gloss:        "但是",
					},
				},
				translation: "但是",
			},
			"because": {
				// No exchange, but has useful data
				senses: []sensePayload{
					{
						language:     commonv1.Language_LANGUAGE_CHINESE,
						partOfSpeech: "conj.",
						gloss:        "因为",
					},
				},
				translation: "因为",
			},
			"run": {
				// Has exchange - should be in newWords if not known
				exchange: "p:ran/d:run/i:running/3:runs",
				senses: []sensePayload{
					{
						language:     commonv1.Language_LANGUAGE_CHINESE,
						partOfSpeech: "v.",
						gloss:        "跑",
					},
				},
			},
		},
		knownForms: make(map[string]bool),
	}

	// First, test without registering known words
	newWords, enrichmentWords, skipped := enricher.GetWordsToProcess()

	// "but" and "because" should be skipped (no exchange, not known)
	// "run" should be in newWords (has exchange, not known)
	if len(newWords) != 1 {
		t.Errorf("Before registration: newWords length = %d, want 1", len(newWords))
	}
	if len(enrichmentWords) != 0 {
		t.Errorf("Before registration: enrichmentWords length = %d, want 0", len(enrichmentWords))
	}

	skippedCount := 0
	for _, skip := range skipped {
		if skip.reason == "no_exchange" {
			skippedCount++
		}
	}
	if skippedCount != 2 {
		t.Errorf("Before registration: skipped (no_exchange) count = %d, want 2", skippedCount)
	}

	// Now register "but" and "because" as known words
	enricher.RegisterKnownWords([]string{"but", "because"})

	// Test again after registering
	newWords, enrichmentWords, skipped = enricher.GetWordsToProcess()

	// Now "but" and "because" should be in enrichmentWords
	// "run" should still be in newWords (has exchange, not registered as known)
	if len(newWords) != 1 {
		t.Errorf("After registration: newWords length = %d, want 1", len(newWords))
	}
	if len(enrichmentWords) != 2 {
		t.Errorf("After registration: enrichmentWords length = %d, want 2 (but, because)", len(enrichmentWords))
	}

	// Verify the enrichment words are correct
	foundBut := false
	foundBecause := false
	for _, word := range enrichmentWords {
		if word.Term == "but" {
			foundBut = true
			if len(word.Meanings) == 0 {
				t.Error("'but' should have meanings")
			}
		}
		if word.Term == "because" {
			foundBecause = true
			if len(word.Meanings) == 0 {
				t.Error("'because' should have meanings")
			}
		}
	}
	if !foundBut {
		t.Error("'but' not found in enrichmentWords after registration")
	}
	if !foundBecause {
		t.Error("'because' not found in enrichmentWords after registration")
	}
}

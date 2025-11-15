package main

import (
	"strings"
	"testing"

	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

func TestParseExchange(t *testing.T) {
	tests := []struct {
		name           string
		currentWord    string
		exchange       string
		wantLemma      string
		wantFormLen    int
		wantFormType   map[dictv1.FormType]string
		wantIrregular  map[dictv1.FormType]bool
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
			{language: 1, partOfSpeech: "verb", gloss: "跑"},
			{language: 1, partOfSpeech: "verb", gloss: "运转"},
			{language: 1, partOfSpeech: "noun", gloss: "跑步"},
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

	if posCount["verb"] != 2 {
		t.Errorf("verb definitions count = %d, want 2", posCount["verb"])
	}
	if posCount["noun"] != 1 {
		t.Errorf("noun definitions count = %d, want 1", posCount["noun"])
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

func TestGetMissingWords_NoDuplicateLemmas(t *testing.T) {
	// Simulate ECDICT having entries for both lemma and inflected forms
	// All pointing to the same lemma "run"
	enricher := &ecdictEnricher{
		entries: map[string]*ecdictEnrichment{
			"run": {
				exchange:    "p:ran/d:run/i:running/3:runs/0:run",
				translation: "v. 跑",
			},
			"ran": {
				exchange:    "p:ran/d:run/i:running/3:runs/0:run",
				translation: "v. 跑",
			},
			"running": {
				exchange:    "p:ran/d:run/i:running/3:runs/0:run",
				translation: "v. 跑",
			},
			"runs": {
				exchange:    "p:ran/d:run/i:running/3:runs/0:run",
				translation: "v. 跑",
			},
		},
		knownForms: make(map[string]bool),
	}

	toImport, _ := enricher.GetMissingWords()

	// Should only create ONE Word object for lemma "run"
	if len(toImport) != 1 {
		t.Errorf("GetMissingWords() created %d Words, want 1 (should deduplicate by lemma)", len(toImport))
	}

	if len(toImport) > 0 && toImport[0].Term != "run" {
		t.Errorf("Word term = %q, want %q", toImport[0].Term, "run")
	}
}

func TestGetMissingWords_PreferLemmaEnrichment(t *testing.T) {
	// When both lemma and inflected forms exist, prefer lemma's enrichment
	enricher := &ecdictEnricher{
		entries: map[string]*ecdictEnrichment{
			"run": {
				exchange:    "p:ran/d:run/i:running/3:runs/0:run",
				translation: "v. 跑步（完整释义）",
			},
			"running": {
				exchange:    "p:ran/d:run/i:running/3:runs/0:run",
				translation: "v. 跑步（不完整）",
			},
		},
		knownForms: make(map[string]bool),
	}

	toImport, _ := enricher.GetMissingWords()

	if len(toImport) != 1 {
		t.Fatalf("GetMissingWords() created %d Words, want 1", len(toImport))
	}

	// Should use "run"'s enrichment (complete translation)
	// We can't directly check translation, but we can verify the word was created
	if toImport[0].Term != "run" {
		t.Errorf("Word term = %q, want %q", toImport[0].Term, "run")
	}
}

func TestGetMissingWords_SkipIfInWikidata(t *testing.T) {
	enricher := &ecdictEnricher{
		entries: map[string]*ecdictEnrichment{
			"run": {
				exchange:    "p:ran/d:run/i:running/3:runs/0:run",
				translation: "v. 跑",
			},
		},
		knownForms: map[string]bool{
			"run": true, // Already in Wikidata
		},
	}

	toImport, _ := enricher.GetMissingWords()

	if len(toImport) != 0 {
		t.Errorf("GetMissingWords() created %d Words, want 0 (should skip words in Wikidata)", len(toImport))
	}
}

func TestMergeEnrichment_WithForms(t *testing.T) {
	// Simulate a Wikidata word that has some forms but not all
	wikidataWord := &dictv1.Word{
		Term:     "run",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "running", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
		},
		Meanings: []*dictv1.Meaning{
			{LexemeId: "L1234", Pos: "verb", Definitions: []*dictv1.Definition{
				{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to move quickly"},
			}},
		},
	}

	// ECDICT enrichment with complete forms from exchange field
	enrichment := &ecdictEnrichment{
		exchange: "p:ran/d:run/i:running/3:runs",
		senses: []sensePayload{
			{language: commonv1.Language_LANGUAGE_CHINESE, partOfSpeech: "verb", gloss: "跑步"},
		},
	}

	changed := mergeEnrichment(wikidataWord, enrichment)

	if !changed {
		t.Error("mergeEnrichment() should return true when forms are added")
	}

	// Check that new forms were added
	formWords := make(map[string]bool)
	for _, form := range wikidataWord.RelatedForms {
		formWords[strings.ToLower(form.Term)] = true
	}

	expectedForms := []string{"running", "ran", "runs", "run"}
	for _, expected := range expectedForms {
		if !formWords[expected] {
			t.Errorf("Expected form %q to be present, but it's missing", expected)
		}
	}

	if len(wikidataWord.RelatedForms) != 4 {
		t.Errorf("RelatedForms length = %d, want 4 (running, ran, runs, run)", len(wikidataWord.RelatedForms))
	}

	// Check that Chinese sense was also added
	hasChinese := false
	for _, meaning := range wikidataWord.Meanings {
		for _, def := range meaning.Definitions {
			if def.Language == commonv1.Language_LANGUAGE_CHINESE {
				hasChinese = true
				break
			}
		}
	}
	if !hasChinese {
		t.Error("Expected Chinese sense to be merged, but it's missing")
	}
}

func TestMergeEnrichment_NoDuplicateForms(t *testing.T) {
	// Wikidata word already has all forms from ECDICT
	wikidataWord := &dictv1.Word{
		Term:     "run",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "ran", FormType: dictv1.FormType_FORM_TYPE_PAST},
			{Term: "running", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
			{Term: "runs", FormType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR},
		},
		Meanings: []*dictv1.Meaning{
			{LexemeId: "L1234", Pos: "verb"},
		},
	}

	enrichment := &ecdictEnrichment{
		exchange: "p:ran/d:run/i:running/3:runs",
	}

	changed := mergeEnrichment(wikidataWord, enrichment)

	// Should return false because no new forms were added (all already exist)
	if changed {
		t.Error("mergeEnrichment() should return false when no new forms are added")
	}

	if len(wikidataWord.RelatedForms) != 3 {
		t.Errorf("RelatedForms length = %d, want 3 (no duplicates)", len(wikidataWord.RelatedForms))
	}
}

package main

import (
	"testing"

	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

func TestParseExchange(t *testing.T) {
	tests := []struct {
		name         string
		currentWord  string
		exchange     string
		wantLemma    string
		wantFormLen  int
		wantFormType map[dictv1.FormType]string
	}{
		{
			name:        "complete verb forms",
			currentWord: "ran",
			exchange:    "p:ran/d:run/i:running/3:runs/0:run",
			wantLemma:   "run",
			wantFormLen: 4,
			wantFormType: map[dictv1.FormType]string{
				dictv1.FormType_FORM_TYPE_PAST:                  "ran",
				dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:       "run",
				dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:    "running",
				dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR: "runs",
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
		},
		{
			name:        "perceived with lemma",
			currentWord: "perceived",
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
			currentWord: "bigger",
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
			currentWord: "cats",
			exchange:    "s:cats/0:cat",
			wantLemma:   "cat",
			wantFormLen: 1,
			wantFormType: map[dictv1.FormType]string{
				dictv1.FormType_FORM_TYPE_PLURAL: "cats",
			},
		},
		{
			name:        "no exchange",
			currentWord: "hello",
			exchange:    "",
			wantLemma:   "",
			wantFormLen: 0,
		},
		{
			name:        "lemma entry for running",
			currentWord: "run",
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
				for _, form := range forms {
					gotFormType[form.Type] = form.Word
				}

				for formType, expectedWord := range tt.wantFormType {
					if gotWord, ok := gotFormType[formType]; !ok {
						t.Errorf("missing form type %v", formType)
					} else if gotWord != expectedWord {
						t.Errorf("form type %v: got word %q, want %q", formType, gotWord, expectedWord)
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

	forms := []*dictv1.WordForm{
		{Word: "ran", Type: dictv1.FormType_FORM_TYPE_PAST},
		{Word: "running", Type: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
	}

	word := buildWordFromECDICT("run", forms, enrichment)

	if word.Lemma != "run" {
		t.Errorf("Lemma = %q, want %q", word.Lemma, "run")
	}

	if len(word.Forms) != 2 {
		t.Errorf("Forms length = %d, want 2", len(word.Forms))
	}

	if len(word.Definitions) != 2 {
		t.Errorf("Definitions length = %d, want 2 (verb and noun)", len(word.Definitions))
	}

	// Check that senses are grouped by POS
	posCount := make(map[string]int)
	for _, def := range word.Definitions {
		posCount[def.Pos] = len(def.Senses)
	}

	if posCount["verb"] != 2 {
		t.Errorf("verb senses count = %d, want 2", posCount["verb"])
	}
	if posCount["noun"] != 1 {
		t.Errorf("noun senses count = %d, want 1", posCount["noun"])
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

	forms := []*dictv1.WordForm{}

	word := buildWordFromECDICT("test", forms, enrichment)

	if len(word.Definitions) != 1 {
		t.Errorf("Definitions length = %d, want 1 (all senses in one definition)", len(word.Definitions))
	}

	if word.Definitions[0].Pos != "" {
		t.Errorf("Definition POS = %q, want empty", word.Definitions[0].Pos)
	}

	if len(word.Definitions[0].Senses) != 2 {
		t.Errorf("Senses in definition = %d, want 2", len(word.Definitions[0].Senses))
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

	if len(toImport) > 0 && toImport[0].Lemma != "run" {
		t.Errorf("Word lemma = %q, want %q", toImport[0].Lemma, "run")
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
	if toImport[0].Lemma != "run" {
		t.Errorf("Word lemma = %q, want %q", toImport[0].Lemma, "run")
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

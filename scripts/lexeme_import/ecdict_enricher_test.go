package main

import (
	"database/sql"
	"testing"
)

func TestRemoveDomainMarkers(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"[计] 碱化", "碱化"},
		{"[法] 社会主义的", "社会主义的"},
		{"[医] 氡, 镭射气", "氡, 镭射气"},
		{"[机] [计] 双重标记", "双重标记"},
		{"no marker here", "no marker here"},
		{"[verylongmarker] should not remove", "[verylongmarker] should not remove"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := removeDomainMarkers(tt.input)
			if result != tt.expected {
				t.Errorf("removeDomainMarkers(%q) = %q; want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestNormalizePOS(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"n", "noun"},
		{"n.", "noun"},
		{"noun", "noun"},
		{"v", "verb"},
		{"v.", "verb"},
		{"vt", "verb"},
		{"vt.", "verb"},
		{"vi", "verb"},
		{"vi.", "verb"},
		{"verb", "verb"},
		{"adj", "adjective"},
		{"adj.", "adjective"},
		{"adjective", "adjective"},
		{"adv", "adverb"},
		{"adv.", "adverb"},
		{"adverb", "adverb"},
		{"prep", "preposition"},
		{"pron", "pronoun"},
		{"conj", "conjunction"},
		{"interj", "interjection"},
		{"int", "interjection"},
		{"art", "article"},
		{"num", "numeral"},
		{"aux", "auxiliary"},
		{"abbr", "abbreviation"},
		{"pref", "prefix"},
		{"suf", "suffix"},
		{"", ""},
		{"unknown", "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := normalizePOS(tt.input)
			if result != tt.expected {
				t.Errorf("normalizePOS(%q) = %q; want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestExtractLeadingPOS(t *testing.T) {
	tests := []struct {
		input        string
		expectedPOS  string
		expectedRest string
	}{
		{"n. a person", "noun", "a person"},
		{"v. to run", "verb", "to run"},
		{"adj. beautiful", "adjective", "beautiful"},
		{"vt. to eat something", "verb", "to eat something"},
		{"[计] n. computer term", "noun", "computer term"},
		{"[法] [医] v. legal medical term", "verb", "legal medical term"},
		{"no pos here", "", "no pos here"},
		{"", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			pos, rest := extractLeadingPOS(tt.input)
			if pos != tt.expectedPOS {
				t.Errorf("extractLeadingPOS(%q) pos = %q; want %q", tt.input, pos, tt.expectedPOS)
			}
			if rest != tt.expectedRest {
				t.Errorf("extractLeadingPOS(%q) rest = %q; want %q", tt.input, rest, tt.expectedRest)
			}
		})
	}
}

func TestBuildSensePayloads_WithPosField(t *testing.T) {
	record := wordRecord{
		Word: "test",
		Pos: sql.NullString{
			Valid:  true,
			String: "n:100", // WordNet format
		},
		Definition: sql.NullString{
			Valid:  true,
			String: "[计] a definition without pos prefix",
		},
		Translation: sql.NullString{
			Valid:  true,
			String: "[法] 一个翻译",
		},
	}

	payloads := buildSensePayloads(record)

	if len(payloads) != 2 {
		t.Fatalf("expected 2 payloads, got %d", len(payloads))
	}

	// First payload (English definition)
	if payloads[0].partOfSpeech != "noun" {
		t.Errorf("expected POS 'noun', got %q", payloads[0].partOfSpeech)
	}
	if payloads[0].gloss != "a definition without pos prefix" {
		t.Errorf("expected gloss without domain marker, got %q", payloads[0].gloss)
	}

	// Second payload (Chinese translation)
	if payloads[1].partOfSpeech != "noun" {
		t.Errorf("expected POS 'noun', got %q", payloads[1].partOfSpeech)
	}
	if payloads[1].gloss != "一个翻译" {
		t.Errorf("expected gloss without domain marker, got %q", payloads[1].gloss)
	}
}

func TestBuildSensePayloads_WithLinePosPrefix(t *testing.T) {
	record := wordRecord{
		Word: "test",
		Pos: sql.NullString{
			Valid:  true,
			String: "n.",
		},
		Definition: sql.NullString{
			Valid:  true,
			String: "v. a verb definition\nadj. an adjective definition",
		},
	}

	payloads := buildSensePayloads(record)

	if len(payloads) != 2 {
		t.Fatalf("expected 2 payloads, got %d", len(payloads))
	}

	// Line-level POS should override the record-level POS
	if payloads[0].partOfSpeech != "verb" {
		t.Errorf("expected POS 'verb', got %q", payloads[0].partOfSpeech)
	}

	if payloads[1].partOfSpeech != "adjective" {
		t.Errorf("expected POS 'adjective', got %q", payloads[1].partOfSpeech)
	}
}

func TestParseWordNetPOS(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"n:100", "noun"},
		{"v:100", "verb"},
		{"j:100", "adjective"},
		{"r:100", "adverb"},
		{"m:100", "numeral"},
		{"s:100", "adjective"}, // adjective satellite
		{"v:5/n:95", "noun"},   // noun has higher probability
		{"v:95/n:5", "verb"},   // verb has higher probability
		{"j:54/n:46", "adjective"},
		{"j:62/n:38", "adjective"},
		{"v:1/n:99", "noun"},
		{"v:8/n:92", "noun"},
		{"", ""},
		{"xyz", "xyz"}, // Unknown POS codes are passed through
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := parseWordNetPOS(tt.input)
			if result != tt.expected {
				t.Errorf("parseWordNetPOS(%q) = %q; want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestWordNetPOSToStandard(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"n", "noun"},
		{"v", "verb"},
		{"j", "adjective"},
		{"r", "adverb"},
		{"m", "numeral"},
		{"s", "adjective"}, // adjective satellite
		{"a", "article"},
		{"i", "preposition"},
		{"p", "pronoun"},
		{"d", "determiner"},
		{"u", "interjection"},
		{"c", "conjunction"},
		{"N", "noun"}, // case insensitive
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := wordNetPOSToStandard(tt.input)
			if result != tt.expected {
				t.Errorf("wordNetPOSToStandard(%q) = %q; want %q", tt.input, result, tt.expected)
			}
		})
	}
}

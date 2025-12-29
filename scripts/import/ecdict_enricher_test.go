package main

import (
	"database/sql"
	"testing"
)

func TestNormalizePOS(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"n", "n."},
		{"n.", "n."},
		{"n.", "n."},
		{"v", "v."},
		{"v.", "v."},
		{"vt", "v."},
		{"vt.", "v."},
		{"vi", "v."},
		{"vi.", "v."},
		{"v.", "v."},
		{"adj", "adj."},
		{"adj.", "adj."},
		{"adj.", "adj."},
		{"adv", "adv."},
		{"adv.", "adv."},
		{"adv.", "adv."},
		{"prep", "prep."},
		{"pron", "pron."},
		{"conj", "conj."},
		{"interj", "interj."},
		{"int", "interj."},
		{"art", "art."},
		{"num", "num."},
		{"aux", "aux."},
		{"abbr", "abbr."},
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

func TestTryExtractPOS(t *testing.T) {
	tests := []struct {
		input        string
		expectedPOS  string
		expectedRest string
	}{
		{"n. a person", "n.", "a person"},
		{"v. to run", "v.", "to run"},
		{"adj. beautiful", "adj.", "beautiful"},
		{"vt. to eat something", "v.", "to eat something"},
		{"[计] n. computer term", "", ""},                    // No POS extraction, keeps domain markers
		{"n. [计] computer term", "n.", "[计] computer term"}, // Extracts POS, keeps domain markers in rest
		{"no pos here", "", ""},
		{"", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			pos, rest := tryExtractPOS(tt.input)
			if pos != tt.expectedPOS {
				t.Errorf("tryExtractPOS(%q) pos = %q; want %q", tt.input, pos, tt.expectedPOS)
			}
			if rest != tt.expectedRest {
				t.Errorf("tryExtractPOS(%q) rest = %q; want %q", tt.input, rest, tt.expectedRest)
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
	if payloads[0].partOfSpeech != "n." {
		t.Errorf("expected POS 'noun', got %q", payloads[0].partOfSpeech)
	}
	// Now we keep domain markers in the gloss
	if payloads[0].gloss != "[计] a definition without pos prefix" {
		t.Errorf("expected gloss with domain marker, got %q", payloads[0].gloss)
	}

	// Second payload (Chinese translation)
	if payloads[1].partOfSpeech != "n." {
		t.Errorf("expected POS 'noun', got %q", payloads[1].partOfSpeech)
	}
	// Now we keep domain markers in the gloss
	if payloads[1].gloss != "[法] 一个翻译" {
		t.Errorf("expected gloss with domain marker, got %q", payloads[1].gloss)
	}
}

func TestBuildSensePayloads_NoPosWithDomainMarker(t *testing.T) {
	record := wordRecord{
		Word: "Beijing",
		// No POS field
		Pos: sql.NullString{Valid: false},
		Translation: sql.NullString{
			Valid:  true,
			String: "[地名] 北京",
		},
	}

	payloads := buildSensePayloads(record)

	if len(payloads) != 1 {
		t.Fatalf("expected 1 payload, got %d", len(payloads))
	}

	// Should be recognized as proper-noun when starting with domain marker and no POS
	if payloads[0].partOfSpeech != "n." {
		t.Errorf("expected POS 'proper-noun', got %q", payloads[0].partOfSpeech)
	}
	if payloads[0].gloss != "[地名] 北京" {
		t.Errorf("expected gloss '[地名] 北京', got %q", payloads[0].gloss)
	}
}

func TestStartsWithDomainMarker(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"[人名] 张三", true},
		{"[地名] 北京", true},
		{"[法] 法律术语", true},
		{"[计] 计算机", true},
		{"normal text", false},
		{"n. definition", false},
		{"", false},
		{"[verylongmarkermorethan10chars] text", false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := startsWithDomainMarker(tt.input)
			if got != tt.want {
				t.Errorf("startsWithDomainMarker(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
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
	if payloads[0].partOfSpeech != "v." {
		t.Errorf("expected POS 'verb', got %q", payloads[0].partOfSpeech)
	}

	if payloads[1].partOfSpeech != "adj." {
		t.Errorf("expected POS 'adjective', got %q", payloads[1].partOfSpeech)
	}
}

func TestParseWordNetPOS(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"n:100", "n."},
		{"v:100", "v."},
		{"j:100", "adj."},
		{"r:100", "adv."},
		{"m:100", "num."},
		{"s:100", "adj."},  // adjective satellite
		{"v:5/n:95", "n."}, // noun has higher probability
		{"v:95/n:5", "v."}, // verb has higher probability
		{"j:54/n:46", "adj."},
		{"j:62/n:38", "adj."},
		{"v:1/n:99", "n."},
		{"v:8/n:92", "n."},
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
		{"n", "n."},
		{"v", "v."},
		{"j", "adj."},
		{"r", "adv."},
		{"m", "num."},
		{"s", "adj."}, // adjective satellite
		{"a", "art."},
		{"i", "prep."},
		{"p", "pron."},
		{"d", "det."},
		{"u", "interj."},
		{"c", "conj."},
		{"N", "n."}, // case insensitive
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

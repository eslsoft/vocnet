package ecdict

import "testing"

func TestExtractDomainMarkers(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "single Chinese marker",
			input: "[计] computer science term",
			want:  []string{"computing"},
		},
		{
			name:  "multiple Chinese markers",
			input: "[计][法] legal computing term",
			want:  []string{"computing", "law"},
		},
		{
			name:  "two-character marker",
			input: "[医学] medical term",
			want:  []string{"medicine"},
		},
		{
			name:  "no marker",
			input: "regular definition",
			want:  nil,
		},
		{
			name:  "marker not at beginning",
			input: "definition [计] with marker in middle",
			want:  nil,
		},
		{
			name:  "multiple mixed markers",
			input: "[数][物][化] mathematics, physics, and chemistry",
			want:  []string{"mathematics", "physics", "chemistry"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractDomainMarkers(tt.input)

			if len(got) != len(tt.want) {
				t.Errorf("extractDomainMarkers() length = %d, want %d\nGot: %v\nWant: %v",
					len(got), len(tt.want), got, tt.want)
				return
			}

			for i, want := range tt.want {
				if got[i] != want {
					t.Errorf("extractDomainMarkers()[%d] = %q, want %q", i, got[i], want)
				}
			}
		})
	}
}

func TestNormalizeDomainMarker(t *testing.T) {
	tests := []struct {
		name   string
		marker string
		want   string
	}{
		{
			name:   "single character",
			marker: "计",
			want:   "computing",
		},
		{
			name:   "two character",
			marker: "医学",
			want:   "medicine",
		},
		{
			name:   "not recognized",
			marker: "未知",
			want:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeDomainMarker(tt.marker)
			if got != tt.want {
				t.Errorf("normalizeDomainMarker(%q) = %q, want %q", tt.marker, got, tt.want)
			}
		})
	}
}

func TestDeduplicateDomains(t *testing.T) {
	tests := []struct {
		name  string
		input []string
		want  []string
	}{
		{
			name:  "no duplicates",
			input: []string{"computing", "law", "medicine"},
			want:  []string{"computing", "law", "medicine"},
		},
		{
			name:  "with duplicates",
			input: []string{"computing", "law", "computing", "medicine", "law"},
			want:  []string{"computing", "law", "medicine"},
		},
		{
			name:  "empty",
			input: nil,
			want:  nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := deduplicateDomains(tt.input)

			if len(got) != len(tt.want) {
				t.Errorf("deduplicateDomains() length = %d, want %d\nGot: %v\nWant: %v",
					len(got), len(tt.want), got, tt.want)
				return
			}

			for i, want := range tt.want {
				if got[i] != want {
					t.Errorf("deduplicateDomains()[%d] = %q, want %q", i, got[i], want)
				}
			}
		})
	}
}

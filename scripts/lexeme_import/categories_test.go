package main

import (
	"testing"
)

func TestInferPOSAndCategories(t *testing.T) {
	tests := []struct {
		name     string
		glosses  []string
		wantPOS  string
		wantCats []string
	}{
		{
			name:     "given name - male",
			glosses:  []string{"male given name"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:person", "person:given-name", "person:male-name"},
		},
		{
			name:     "family name",
			glosses:  []string{"family name"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:person", "person:family-name"},
		},
		{
			name:     "city",
			glosses:  []string{"city in Texas"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:place", "place:city"},
		},
		{
			name:     "city - standalone",
			glosses:  []string{"Canadian city"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:place", "place:city"},
		},
		{
			name:     "state",
			glosses:  []string{"American state"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:place", "place:state"},
		},
		{
			name:     "country",
			glosses:  []string{"country in Europe"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:place", "place:country"},
		},
		{
			name:     "capital",
			glosses:  []string{"capital of France"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:place", "place:capital", "place:city"},
		},
		{
			name:     "territory",
			glosses:  []string{"territory in the Pacific"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:place", "place:territory"},
		},
		{
			name:     "historic region",
			glosses:  []string{"historic land in Poland"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:place", "place:region"},
		},
		{
			name:     "weekday",
			glosses:  []string{"day after Sunday"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:time", "attr:weekday"},
		},
		{
			name:     "month",
			glosses:  []string{"month of the year"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:time", "attr:month"},
		},
		{
			name:     "company",
			glosses:  []string{"technology company"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:organization", "org:company"},
		},
		{
			name:     "university",
			glosses:  []string{"university in California"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:organization", "org:university"},
		},
		{
			name:     "game",
			glosses:  []string{"web-based word game created by Josh"},
			wantPOS:  "proper-noun",
			wantCats: []string{"product:game"},
		},
		{
			name:     "demonym",
			glosses:  []string{"person from Ohio"},
			wantPOS:  "noun",
			wantCats: []string{"attr:demonym"},
		},
		{
			name:     "language",
			glosses:  []string{"language spoken in France"},
			wantPOS:  "proper-noun",
			wantCats: []string{"entity:language"},
		},
		{
			name:     "dog breed",
			glosses:  []string{"dog breed from Germany"},
			wantPOS:  "noun",
			wantCats: []string{"attr:animal", "attr:dog-breed"},
		},
		{
			name:     "concept",
			glosses:  []string{"concept explains that similar body plans evolve independently"},
			wantPOS:  "noun",
			wantCats: []string{"attr:concept"},
		},
		{
			name:     "phrase",
			glosses:  []string{"phrase used to express greeting"},
			wantPOS:  "",
			wantCats: []string{"attr:phrase"},
		},
		{
			name:     "no pattern",
			glosses:  []string{"some random definition"},
			wantPOS:  "",
			wantCats: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			senses := make([]WikidataSense, len(tt.glosses))
			for i, gloss := range tt.glosses {
				senses[i] = WikidataSense{
					Glosses: map[string]WikidataValue{
						"en": {Value: gloss},
					},
				}
			}

			result := inferPOSAndCategories(senses)

			if result.POS != tt.wantPOS {
				t.Errorf("POS = %q, want %q", result.POS, tt.wantPOS)
			}

			if len(result.Categories) != len(tt.wantCats) {
				t.Errorf("Categories length = %d, want %d\nGot: %v\nWant: %v",
					len(result.Categories), len(tt.wantCats), result.Categories, tt.wantCats)
				return
			}

			for i, want := range tt.wantCats {
				if result.Categories[i] != want {
					t.Errorf("Categories[%d] = %q, want %q", i, result.Categories[i], want)
				}
			}
		})
	}
}

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
		marker string
		want   string
	}{
		// Computing & Technology
		{"计", "computing"},
		{"计算机", "computing"},
		{"网络", "network"},
		{"电", "electronics"},
		{"电影", "film"},

		// Science
		{"法", "law"},
		{"医", "medicine"},
		{"医学", "medicine"},
		{"化", "chemistry"},
		{"数", "mathematics"},
		{"物", "physics"},
		{"地质", "geology"},
		{"生化", "biochemistry"},
		{"生态", "ecology"},

		// Life Sciences
		{"内科", "internal-medicine"},
		{"心理", "psychology"},
		{"植", "botany"},
		{"动", "zoology"},
		{"昆", "entomology"},

		// Geography markers (should be skipped)
		{"地名", "geography"},
		{"人名", ""},
		{"美国", ""},
		{"德国", ""},
		{"俄罗斯", ""},

		// Grammar markers (should be skipped)
		{"前缀", ""},
		{"复", ""},
		{"单复同", ""},
		{"pl.", ""},

		// Already English
		{"computing", "computing"},
		{"medicine", "medicine"},

		// Unknown markers
		{"unknown", "unknown"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.marker, func(t *testing.T) {
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
			name:  "case insensitive dedup",
			input: []string{"Computing", "LAW", "computing", "law"},
			want:  []string{"computing", "law"},
		},
		{
			name:  "empty input",
			input: []string{},
			want:  nil,
		},
		{
			name:  "with empty strings",
			input: []string{"computing", "", "law", "  ", "medicine"},
			want:  []string{"computing", "law", "medicine"},
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

func TestAppendUnique(t *testing.T) {
	tests := []struct {
		name  string
		slice []string
		items []string
		want  []string
	}{
		{
			name:  "append to empty",
			slice: []string{},
			items: []string{"a", "b", "c"},
			want:  []string{"a", "b", "c"},
		},
		{
			name:  "append with no duplicates",
			slice: []string{"a", "b"},
			items: []string{"c", "d"},
			want:  []string{"a", "b", "c", "d"},
		},
		{
			name:  "append with duplicates",
			slice: []string{"a", "b"},
			items: []string{"b", "c", "a", "d"},
			want:  []string{"a", "b", "c", "d"},
		},
		{
			name:  "all duplicates",
			slice: []string{"a", "b", "c"},
			items: []string{"a", "b", "c"},
			want:  []string{"a", "b", "c"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := appendUnique(tt.slice, tt.items...)

			if len(got) != len(tt.want) {
				t.Errorf("appendUnique() length = %d, want %d\nGot: %v\nWant: %v",
					len(got), len(tt.want), got, tt.want)
				return
			}

			for i, want := range tt.want {
				if got[i] != want {
					t.Errorf("appendUnique()[%d] = %q, want %q", i, got[i], want)
				}
			}
		})
	}
}

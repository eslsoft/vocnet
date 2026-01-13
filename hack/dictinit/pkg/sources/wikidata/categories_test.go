package wikidata

import "testing"

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
			wantPOS:  "n.",
			wantCats: []string{"entity:person", "person:given-name", "person:male-name"},
		},
		{
			name:     "family name",
			glosses:  []string{"family name"},
			wantPOS:  "n.",
			wantCats: []string{"entity:person", "person:family-name"},
		},
		{
			name:     "city",
			glosses:  []string{"city in Texas"},
			wantPOS:  "n.",
			wantCats: []string{"entity:place", "place:city"},
		},
		{
			name:     "city - standalone",
			glosses:  []string{"Canadian city"},
			wantPOS:  "n.",
			wantCats: []string{"entity:place", "place:city"},
		},
		{
			name:     "state",
			glosses:  []string{"American state"},
			wantPOS:  "n.",
			wantCats: []string{"entity:place", "place:state"},
		},
		{
			name:     "country",
			glosses:  []string{"country in Europe"},
			wantPOS:  "n.",
			wantCats: []string{"entity:place", "place:country"},
		},
		{
			name:     "capital",
			glosses:  []string{"capital of France"},
			wantPOS:  "n.",
			wantCats: []string{"entity:place", "place:capital", "place:city"},
		},
		{
			name:     "territory",
			glosses:  []string{"territory in the Pacific"},
			wantPOS:  "n.",
			wantCats: []string{"entity:place", "place:territory"},
		},
		{
			name:     "historic region",
			glosses:  []string{"historic land in Poland"},
			wantPOS:  "n.",
			wantCats: []string{"entity:place", "place:region"},
		},
		{
			name:     "weekday",
			glosses:  []string{"day after Sunday"},
			wantPOS:  "n.",
			wantCats: []string{"entity:time", "attr:weekday"},
		},
		{
			name:     "month",
			glosses:  []string{"month of the year"},
			wantPOS:  "n.",
			wantCats: []string{"entity:time", "attr:month"},
		},
		{
			name:     "company",
			glosses:  []string{"technology company"},
			wantPOS:  "n.",
			wantCats: []string{"entity:organization", "org:company"},
		},
		{
			name:     "university",
			glosses:  []string{"university in California"},
			wantPOS:  "n.",
			wantCats: []string{"entity:organization", "org:university"},
		},
		{
			name:     "game",
			glosses:  []string{"web-based word game created by Josh"},
			wantPOS:  "n.",
			wantCats: []string{"product:game"},
		},
		{
			name:     "demonym",
			glosses:  []string{"person from Ohio"},
			wantPOS:  "n.",
			wantCats: []string{"attr:demonym"},
		},
		{
			name:     "language",
			glosses:  []string{"language spoken in France"},
			wantPOS:  "n.",
			wantCats: []string{"entity:language"},
		},
		{
			name:     "dog breed",
			glosses:  []string{"dog breed from Germany"},
			wantPOS:  "n.",
			wantCats: []string{"attr:animal", "attr:dog-breed"},
		},
		{
			name:     "concept",
			glosses:  []string{"concept explains that similar body plans evolve independently"},
			wantPOS:  "n.",
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

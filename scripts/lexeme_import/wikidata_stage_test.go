package main

import (
	"testing"
)

func TestInferPOSFromGlosses(t *testing.T) {
	tests := []struct {
		name     string
		senses   []WikidataSense
		expected string
	}{
		{
			name: "family name",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "family name"},
					},
				},
			},
			expected: "noun",
		},
		{
			name: "given name",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "male given name"},
					},
				},
			},
			expected: "noun",
		},
		{
			name: "place name - city",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "city in England"},
					},
				},
			},
			expected: "noun",
		},
		{
			name: "place name - country",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "country in Europe"},
					},
				},
			},
			expected: "noun",
		},
		{
			name: "organization",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "technology company"},
					},
				},
			},
			expected: "noun",
		},
		{
			name: "dog breed",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "dog breed from Germany"},
					},
				},
			},
			expected: "noun",
		},
		{
			name: "phrase - no POS",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "idiomatic phrase meaning something"},
					},
				},
			},
			expected: "",
		},
		{
			name: "no pattern match",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "something unrecognizable"},
					},
				},
			},
			expected: "",
		},
		{
			name: "empty glosses",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{},
				},
			},
			expected: "",
		},
		{
			name: "multiple senses - first match wins",
			senses: []WikidataSense{
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "place name"},
					},
				},
				{
					Glosses: map[string]WikidataValue{
						"en": {Value: "something else"},
					},
				},
			},
			expected: "noun",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := inferPOSFromGlosses(tt.senses)
			if result != tt.expected {
				t.Errorf("inferPOSFromGlosses() = %q; want %q", result, tt.expected)
			}
		})
	}
}

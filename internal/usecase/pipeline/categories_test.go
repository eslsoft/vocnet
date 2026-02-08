package pipeline

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/assert"
)

func TestInferCategoriesFromSenses_PersonNames(t *testing.T) {
	tests := []struct {
		name       string
		senses     []entity.LexemeSense
		wantCategories []string
	}{
		{
			name: "male given name",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a male given name"},
			},
			wantCategories: []string{"entity:person", "person:given-name", "person:male-name"},
		},
		{
			name: "female given name",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a female given name"},
			},
			wantCategories: []string{"entity:person", "person:given-name", "person:female-name"},
		},
		{
			name: "family name",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a family name"},
			},
			wantCategories: []string{"entity:person", "person:family-name"},
		},
		{
			name: "surname",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a surname of English origin"},
			},
			wantCategories: []string{"entity:person", "person:family-name"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			categories := InferCategoriesFromSenses(tt.senses)
			assert.ElementsMatch(t, tt.wantCategories, categories, "categories should match")
		})
	}
}

func TestInferCategoriesFromSenses_Places(t *testing.T) {
	tests := []struct {
		name       string
		senses     []entity.LexemeSense
		wantCategories []string
	}{
		{
			name: "city",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a city in France"},
			},
			wantCategories: []string{"entity:place", "place:city"},
		},
		{
			name: "capital",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "the capital of France"},
			},
			wantCategories: []string{"entity:place", "place:capital", "place:city"},
		},
		{
			name: "state",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a state in the United States"},
			},
			wantCategories: []string{"entity:place", "place:state"},
		},
		{
			name: "country",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a country in Europe"},
			},
			wantCategories: []string{"entity:place", "place:country"},
		},
		{
			name: "river",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a river in Asia"},
			},
			wantCategories: []string{"entity:place", "place:river"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			categories := InferCategoriesFromSenses(tt.senses)
			assert.ElementsMatch(t, tt.wantCategories, categories, "categories should match")
		})
	}
}

func TestInferCategoriesFromSenses_Time(t *testing.T) {
	tests := []struct {
		name       string
		senses     []entity.LexemeSense
		wantCategories []string
	}{
		{
			name: "weekday",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "the day of the week after Sunday"},
			},
			wantCategories: []string{"entity:time", "attr:weekday"},
		},
		{
			name: "month",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "the first month of the year"},
			},
			wantCategories: []string{"entity:time", "attr:month"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			categories := InferCategoriesFromSenses(tt.senses)
			assert.ElementsMatch(t, tt.wantCategories, categories, "categories should match")
		})
	}
}

func TestInferCategoriesFromSenses_Organizations(t *testing.T) {
	tests := []struct {
		name       string
		senses     []entity.LexemeSense
		wantCategories []string
	}{
		{
			name: "company",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "an American technology company"},
			},
			wantCategories: []string{"entity:organization", "org:company"},
		},
		{
			name: "university",
			senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "a university in California"},
			},
			wantCategories: []string{"entity:organization", "org:university"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			categories := InferCategoriesFromSenses(tt.senses)
			assert.ElementsMatch(t, tt.wantCategories, categories, "categories should match")
		})
	}
}

func TestExtractDomainCategories(t *testing.T) {
	tests := []struct {
		name       string
		tags       []string
		wantCategories []string
	}{
		{
			name:       "computing",
			tags:       []string{"zk"},
			wantCategories: []string{"domain:computing"},
		},
		{
			name:       "computing and gk",
			tags:       []string{"zk", "gk"},
			wantCategories: []string{"domain:computing"}, // gk is not a domain tag
		},
		{
			name:       "medicine",
			tags:       []string{"yi"},
			wantCategories: []string{"domain:medicine"},
		},
		{
			name:       "multiple domains",
			tags:       []string{"zk", "sx"},
			wantCategories: []string{"domain:computing", "domain:mathematics"},
		},
		{
			name:       "no domain tags",
			tags:       []string{"gk", "cet4"},
			wantCategories: []string{},
		},
		{
			name:       "empty tags",
			tags:       []string{},
			wantCategories: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			categories := ExtractDomainCategories(tt.tags)
			assert.ElementsMatch(t, tt.wantCategories, categories, "domain categories should match")
		})
	}
}

func TestAppendUnique(t *testing.T) {
	tests := []struct {
		name     string
		initial  []string
		toAdd    []string
		expected []string
	}{
		{
			name:     "add to empty",
			initial:  []string{},
			toAdd:    []string{"a", "b"},
			expected: []string{"a", "b"},
		},
		{
			name:     "add with duplicates",
			initial:  []string{"a", "b"},
			toAdd:    []string{"b", "c"},
			expected: []string{"a", "b", "c"},
		},
		{
			name:     "add nothing new",
			initial:  []string{"a", "b"},
			toAdd:    []string{"a", "b"},
			expected: []string{"a", "b"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := appendUnique(tt.initial, tt.toAdd...)
			assert.ElementsMatch(t, tt.expected, result, "result should match expected")
		})
	}
}

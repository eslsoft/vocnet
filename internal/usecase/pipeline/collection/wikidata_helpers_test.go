package collection

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseWikidataPOS_QID(t *testing.T) {
	pos, err := parseWikidataPOS("Q1084")
	require.NoError(t, err)
	assert.Equal(t, entity.PartOfSpeechNoun, pos)
}

func TestParseWikidataPOS_UnknownQIDFails(t *testing.T) {
	_, err := parseWikidataPOS("Q999999999")
	assert.Error(t, err)
}

func TestParseWikidataPOS_AdditionalQIDMappings(t *testing.T) {
	tests := []struct {
		qid      string
		expected entity.PartOfSpeech
	}{
		{"Q54310231", entity.PartOfSpeechPronoun},
		{"Q576271", entity.PartOfSpeechDeterminer},
		{"Q468801", entity.PartOfSpeechPronoun},
		{"Q5051", entity.PartOfSpeechDeterminer},
		{"Q7250170", entity.PartOfSpeechAdjective},
		{"Q10265745", entity.PartOfSpeechDeterminer},
		{"Q1050744", entity.PartOfSpeechPronoun},
		{"Q10535365", entity.PartOfSpeechParticle},
		{"Q113076880", entity.PartOfSpeechAdverb},
		{"Q113198319", entity.PartOfSpeechParticle},
		{"Q1668170", entity.PartOfSpeechAdverb},
		{"Q1989081", entity.PartOfSpeechPronoun},
		{"Q2304610", entity.PartOfSpeechPronoun},
		{"Q2865743", entity.PartOfSpeechDeterminer},
		{"Q34793275", entity.PartOfSpeechPronoun},
		{"Q3813849", entity.PartOfSpeechDeterminer},
		{"Q3976700", entity.PartOfSpeechSuffix},
		{"Q66614509", entity.PartOfSpeechSuffix},
		{"Q956030", entity.PartOfSpeechPronoun},
	}

	for _, tt := range tests {
		t.Run(tt.qid, func(t *testing.T) {
			pos, err := parseWikidataPOS(tt.qid)
			require.NoError(t, err)
			assert.Equal(t, tt.expected, pos)
		})
	}
}

func TestMapGrammaticalFeaturesToFormType(t *testing.T) {
	tests := []struct {
		name     string
		features []string
		expected entity.FormType
	}{
		{"empty features", []string{}, entity.FormTypeLemma},
		{"plural", []string{"Q146786"}, entity.FormTypePlural},
		{"past tense", []string{"Q1994301"}, entity.FormTypePast},
		{"past participle", []string{"Q12612489"}, entity.FormTypePastParticiple},
		{"present participle", []string{"Q10345583"}, entity.FormTypePresentParticiple},
		{"comparative", []string{"Q14169499"}, entity.FormTypeComparative},
		{"superlative", []string{"Q1817208"}, entity.FormTypeSuperlative},
		{"third person singular", []string{"Q51929049", "Q110786"}, entity.FormTypeThirdPersonSingular},
		{"explicit lemma marker", []string{"Q3910936"}, entity.FormTypeLemma},
		{"unknown features default to lemma", []string{"Q999999"}, entity.FormTypeLemma},
		{"third person without singular", []string{"Q51929049"}, entity.FormTypeLemma},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := mapGrammaticalFeaturesToFormType(tt.features)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestRejectLowConfidenceLexemeMatch(t *testing.T) {
	tests := []struct {
		name     string
		evidence map[string]any
		expected bool
	}{
		{"empty evidence", nil, false},
		{"no match_score", map[string]any{"other": "value"}, false},
		{"high score", map[string]any{"match_score": 80, "candidate_count": 2}, false},
		{"low score single candidate", map[string]any{"match_score": 30, "candidate_count": 1}, false},
		{"low score multiple candidates", map[string]any{"match_score": 40, "candidate_count": 2}, true},
		{"low score float64", map[string]any{"match_score": 30.0, "candidate_count": 3.0}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := rejectLowConfidenceLexemeMatch(tt.evidence)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// =============================================================================
// Category Inference Tests
// =============================================================================

func TestInferCategoriesFromSenses_PersonNames(t *testing.T) {
	tests := []struct {
		name           string
		senses         []entity.LexemeSense
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
			categories := inferCategoriesFromSenses(tt.senses)
			assert.ElementsMatch(t, tt.wantCategories, categories, "categories should match")
		})
	}
}

func TestInferCategoriesFromSenses_Places(t *testing.T) {
	tests := []struct {
		name           string
		senses         []entity.LexemeSense
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
			categories := inferCategoriesFromSenses(tt.senses)
			assert.ElementsMatch(t, tt.wantCategories, categories, "categories should match")
		})
	}
}

func TestInferCategoriesFromSenses_Time(t *testing.T) {
	tests := []struct {
		name           string
		senses         []entity.LexemeSense
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
			categories := inferCategoriesFromSenses(tt.senses)
			assert.ElementsMatch(t, tt.wantCategories, categories, "categories should match")
		})
	}
}

func TestInferCategoriesFromSenses_Organizations(t *testing.T) {
	tests := []struct {
		name           string
		senses         []entity.LexemeSense
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
			categories := inferCategoriesFromSenses(tt.senses)
			assert.ElementsMatch(t, tt.wantCategories, categories, "categories should match")
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

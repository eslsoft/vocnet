package pipeline

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/eslsoft/vocnet/internal/entity"
)

func TestRuleBasedScorer_ScoreLexeme(t *testing.T) {
	scorer := NewRuleBasedScorer()

	tests := []struct {
		name     string
		lexeme   *entity.Lexeme
		provider string
		wantMin  float64
		wantMax  float64
	}{
		{
			name:     "nil lexeme",
			lexeme:   nil,
			provider: "test",
			wantMin:  0,
			wantMax:  0,
		},
		{
			name: "minimal lexeme",
			lexeme: &entity.Lexeme{
				ExternalID:   "",
				PartOfSpeech: entity.PartOfSpeechUnspecified,
				Senses:       nil,
				Categories:   nil,
			},
			provider: "test",
			wantMin:  40,
			wantMax:  40,
		},
		{
			name: "lexeme with POS only",
			lexeme: &entity.Lexeme{
				PartOfSpeech: entity.PartOfSpeechNoun,
			},
			provider: "test",
			wantMin:  60,
			wantMax:  60,
		},
		{
			name: "complete lexeme",
			lexeme: &entity.Lexeme{
				ExternalID:   "L123",
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "a word"},
				},
				Categories: []string{"basic"},
			},
			provider: "wikidata",
			wantMin:  100,
			wantMax:  105, // can exceed 100 before capping
		},
		{
			name: "lexeme with non-Wikidata ID",
			lexeme: &entity.Lexeme{
				ExternalID:   "ecdict:123",
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "a word"},
				},
				Categories: []string{"basic"},
			},
			provider: "ecdict",
			wantMin:  90,
			wantMax:  90,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score := scorer.ScoreLexeme(tt.lexeme, tt.provider)
			assert.GreaterOrEqual(t, score.Score, tt.wantMin)
			assert.LessOrEqual(t, score.Score, 100.0) // always capped at 100
			assert.Equal(t, tt.provider, score.Provider)
		})
	}
}

func TestRuleBasedScorer_ScoreForm(t *testing.T) {
	scorer := NewRuleBasedScorer()

	tests := []struct {
		name     string
		form     *entity.LemmaForm
		provider string
		want     float64
	}{
		{
			name:     "nil form",
			form:     nil,
			provider: "test",
			want:     0,
		},
		{
			name: "minimal form",
			form: &entity.LemmaForm{
				Surface:   "run",
				FormType:  entity.FormTypeLemma,
				Phonetics: nil,
				Syllables: nil,
			},
			provider: "test",
			want:     50,
		},
		{
			name: "form with phonetics",
			form: &entity.LemmaForm{
				Surface:  "run",
				FormType: entity.FormTypeLemma,
				Phonetics: []entity.Phonetic{
					{IPA: "/rʌn/", Dialect: "US"},
				},
			},
			provider: "test",
			want:     75,
		},
		{
			name: "complete form",
			form: &entity.LemmaForm{
				Surface:  "run",
				FormType: entity.FormTypeLemma,
				Phonetics: []entity.Phonetic{
					{IPA: "/rʌn/", Dialect: "US"},
				},
				Syllables: []string{"run"},
			},
			provider: "moby",
			want:     100,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score := scorer.ScoreForm(tt.form, tt.provider)
			assert.Equal(t, tt.want, score.Score)
			assert.Equal(t, tt.provider, score.Provider)
		})
	}
}

func TestRuleBasedScorer_ScoreLemmaField_Level(t *testing.T) {
	scorer := NewRuleBasedScorer()

	tests := []struct {
		name  string
		level string
		want  float64
	}{
		{"empty", "", 0},
		{"A1", "A1", 100},
		{"A2", "A2", 90},
		{"B1", "B1", 80},
		{"B2", "B2", 70},
		{"C1", "C1", 60},
		{"C2", "C2", 50},
		{"unknown", "X9", 0},
		{"lowercase a1", "a1", 100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score := scorer.ScoreLemmaField("level", tt.level, "cefrj")
			assert.Equal(t, tt.want, score.Score)
		})
	}
}

func TestRuleBasedScorer_ScoreRelation(t *testing.T) {
	scorer := NewRuleBasedScorer()

	tests := []struct {
		name string
		rel  *entity.SemanticRelation
		want float64
	}{
		{
			name: "nil relation",
			rel:  nil,
			want: 0,
		},
		{
			name: "minimal relation",
			rel: &entity.SemanticRelation{
				Provider:     "conceptnet",
				RelationType: entity.RelationSynonym,
				Strength:     -1, // invalid, out of range
			},
			want: 30,
		},
		{
			name: "resolved relation",
			rel: &entity.SemanticRelation{
				Provider:       "wordnet",
				RelationType:   entity.RelationHypernym,
				TargetLexemeID: ptrInt64(123),
				TargetRef:      "internal:123",
				Strength:       -1, // invalid
			},
			want: 60,
		},
		{
			name: "sense-mapped relation",
			rel: &entity.SemanticRelation{
				Provider:       "wordnet",
				RelationType:   entity.RelationHypernym,
				TargetLexemeID: ptrInt64(123),
				SenseMapped:    true,
				Strength:       -1, // invalid
			},
			want: 80,
		},
		{
			name: "complete relation",
			rel: &entity.SemanticRelation{
				Provider:       "wordnet",
				RelationType:   entity.RelationHypernym,
				TargetLexemeID: ptrInt64(123),
				TargetRef:      "internal:123",
				SenseMapped:    true,
				Strength:       0.8,
			},
			want: 100,
		},
		{
			name: "invalid strength",
			rel: &entity.SemanticRelation{
				Provider:       "wordnet",
				RelationType:   entity.RelationHypernym,
				TargetLexemeID: ptrInt64(123),
				SenseMapped:    true,
				Strength:       1.5, // out of range
			},
			want: 80,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score := scorer.ScoreRelation(tt.rel)
			assert.Equal(t, tt.want, score.Score)
		})
	}
}

func TestDecideAdoption(t *testing.T) {
	tests := []struct {
		name          string
		existingScore FieldScore
		newScore      FieldScore
		existingEmpty bool
		wantAdopt     bool
		wantReason    string
	}{
		{
			name:          "empty field - always adopt",
			existingScore: FieldScore{Score: 0, Provider: ""},
			newScore:      FieldScore{Score: 50, Provider: "test"},
			existingEmpty: true,
			wantAdopt:     true,
			wantReason:    "empty field - always adopt",
		},
		{
			name:          "new score higher",
			existingScore: FieldScore{Score: 60, Provider: "conceptnet"},
			newScore:      FieldScore{Score: 80, Provider: "wikidata"},
			existingEmpty: false,
			wantAdopt:     true,
			wantReason:    "new score higher",
		},
		{
			name:          "new score lower",
			existingScore: FieldScore{Score: 80, Provider: "wikidata"},
			newScore:      FieldScore{Score: 60, Provider: "conceptnet"},
			existingEmpty: false,
			wantAdopt:     false,
			wantReason:    "new score lower",
		},
		{
			name:          "tie - new source more trusted",
			existingScore: FieldScore{Score: 70, Provider: "conceptnet"},
			newScore:      FieldScore{Score: 70, Provider: "wikidata"},
			existingEmpty: false,
			wantAdopt:     true,
			wantReason:    "tie - new source more trusted",
		},
		{
			name:          "tie - existing source more trusted",
			existingScore: FieldScore{Score: 70, Provider: "wikidata"},
			newScore:      FieldScore{Score: 70, Provider: "conceptnet"},
			existingEmpty: false,
			wantAdopt:     false,
			wantReason:    "tie - existing source equally or more trusted",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			decision := DecideAdoption(tt.existingScore, tt.newScore, tt.existingEmpty)
			assert.Equal(t, tt.wantAdopt, decision.ShouldAdopt)
			assert.Contains(t, decision.Reason, tt.wantReason)
		})
	}
}

func TestSourceProviderTrustRank(t *testing.T) {
	tests := []struct {
		provider string
		want     int
	}{
		{"wikidata", 5},
		{"wordnet", 4},
		{"llm", 3},
		{"ecdict", 2},
		{"conceptnet", 1},
		{"unknown", 0},
		{"", 0},
	}

	for _, tt := range tests {
		t.Run(tt.provider, func(t *testing.T) {
			rank := sourceProviderTrustRank(tt.provider)
			assert.Equal(t, tt.want, rank)
		})
	}
}

func TestDataEvaluator_EvaluateAndMergeLexemes(t *testing.T) {
	scorer := NewRuleBasedScorer()
	evaluator := NewDataEvaluator(scorer, nil)

	existing := []*entity.Lexeme{
		{
			ExternalID:   "L123",
			PartOfSpeech: entity.PartOfSpeechNoun,
			Senses: []entity.LexemeSense{
				{Language: entity.LanguageEnglish, Gloss: "existing sense"},
			},
		},
	}

	t.Run("adopt new lexeme - no conflict", func(t *testing.T) {
		newLexemes := []*entity.Lexeme{
			{
				ExternalID:   "L456",
				PartOfSpeech: entity.PartOfSpeechVerb,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "new sense"},
				},
			},
		}

		merged, decisions := evaluator.EvaluateAndMergeLexemes(existing, newLexemes, "wikidata")
		require.Len(t, merged, 2)
		require.Len(t, decisions, 1)
		assert.True(t, decisions[0].ShouldAdopt)
	})

	t.Run("merge existing lexeme - higher score", func(t *testing.T) {
		newLexemes := []*entity.Lexeme{
			{
				ExternalID:   "L123",
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "new sense"},
				},
				Categories: []string{"category1"},
			},
		}

		merged, decisions := evaluator.EvaluateAndMergeLexemes(existing, newLexemes, "wikidata")
		require.Len(t, merged, 1)
		require.Len(t, decisions, 1)
		assert.True(t, decisions[0].ShouldAdopt)
		assert.Len(t, merged[0].Senses, 2) // merged senses
		assert.Len(t, merged[0].Categories, 1)
	})
}

func TestDataEvaluator_EvaluateAndMergeForms(t *testing.T) {
	scorer := NewRuleBasedScorer()
	evaluator := NewDataEvaluator(scorer, nil)

	existing := []*entity.LemmaForm{
		{
			Surface:  "run",
			FormType: entity.FormTypeLemma,
		},
	}

	t.Run("adopt new form - no conflict", func(t *testing.T) {
		newForms := []*entity.LemmaForm{
			{
				Surface:  "running",
				FormType: entity.FormTypeGerund,
			},
		}

		merged, decisions := evaluator.EvaluateAndMergeForms(existing, newForms, "wikidata")
		require.Len(t, merged, 2)
		require.Len(t, decisions, 1)
		assert.True(t, decisions[0].ShouldAdopt)
	})

	t.Run("enrich existing form with syllables", func(t *testing.T) {
		newForms := []*entity.LemmaForm{
			{
				Surface:   "run",
				FormType:  entity.FormTypeLemma,
				Syllables: []string{"run"},
			},
		}

		merged, decisions := evaluator.EvaluateAndMergeForms(existing, newForms, "moby")
		require.Len(t, merged, 1)
		require.Len(t, decisions, 1)
		assert.True(t, decisions[0].ShouldAdopt)
		assert.Equal(t, []string{"run"}, merged[0].Syllables)
	})
}

func TestDataEvaluator_EvaluateAndMergeLemmaUpdate(t *testing.T) {
	scorer := NewRuleBasedScorer()
	evaluator := NewDataEvaluator(scorer, nil)

	existing := &entity.Lemma{
		ID:    1,
		Level: "B1",
	}

	t.Run("adopt better level", func(t *testing.T) {
		update := &entity.Lemma{
			Level: "A2",
		}

		merged, decisions := evaluator.EvaluateAndMergeLemmaUpdate(existing, update, "cefrj")
		require.NotNil(t, merged)
		require.Len(t, decisions, 1)
		assert.True(t, decisions[0].ShouldAdopt)
		assert.Equal(t, "A2", merged.Level)
		assert.Equal(t, int64(1), merged.ID) // ID preserved
	})

	t.Run("reject worse level", func(t *testing.T) {
		update := &entity.Lemma{
			Level: "C1",
		}

		merged, decisions := evaluator.EvaluateAndMergeLemmaUpdate(existing, update, "cefrj")
		require.NotNil(t, merged)
		require.Len(t, decisions, 1)
		assert.False(t, decisions[0].ShouldAdopt)
		assert.Equal(t, "B1", merged.Level) // unchanged
	})

	t.Run("merge frequencies by corpus", func(t *testing.T) {
		existingWithFreqs := &entity.Lemma{
			ID: 1,
			Frequencies: []entity.Frequency{
				{Corpus: "coca", Count: 1000},
			},
		}

		update := &entity.Lemma{
			Frequencies: []entity.Frequency{
				{Corpus: "bnc", Count: 500},
			},
		}

		merged, _ := evaluator.EvaluateAndMergeLemmaUpdate(existingWithFreqs, update, "test")
		require.NotNil(t, merged)
		assert.Len(t, merged.Frequencies, 2)
	})
}

func ptrInt64(v int64) *int64 {
	return &v
}

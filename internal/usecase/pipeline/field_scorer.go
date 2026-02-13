package pipeline

import (
	"github.com/eslsoft/vocnet/internal/entity"
)

// FieldScore represents the quality score of a field, along with metadata
// about the scoring decision.
type FieldScore struct {
	Score      float64 // 0-100 quality score
	Provider   string  // Source provider name
	Confidence float64 // 0-1 confidence in this score (for LLM scorers)
	Reason     string  // Optional explanation for debugging
}

// FieldScorer evaluates the quality of individual fields from different sources.
// Implementations can use rule-based logic, ML models, or LLM-based scoring.
type FieldScorer interface {
	// ScoreLexeme computes quality score for a lexeme.
	// Returns 0-100 score. Higher = better quality.
	ScoreLexeme(lex *entity.Lexeme, provider string) FieldScore

	// ScoreForm computes quality score for a lemma form.
	ScoreForm(form *entity.LemmaForm, provider string) FieldScore

	// ScoreLemmaField computes quality score for a specific lemma-level field.
	// fieldName: "level", "frequencies", "syllables"
	// value: the actual field value to score
	ScoreLemmaField(fieldName string, value any, provider string) FieldScore

	// ScoreRelation computes quality score for a semantic relation.
	ScoreRelation(rel *entity.SemanticRelation) FieldScore
}

// AdoptionDecision represents whether to adopt a new field value.
type AdoptionDecision struct {
	ShouldAdopt    bool    // Whether to adopt the new value
	ExistingScore  float64 // Score of existing value (0 if empty)
	NewScore       float64 // Score of new value
	ExistingSource string  // Provider of existing value
	NewSource      string  // Provider of new value
	Reason         string  // Human-readable explanation
}

// DecideAdoption determines whether to adopt new data based on scoring.
// Empty fields are always adopted. For conflicts, higher score wins.
func DecideAdoption(existingScore, newScore FieldScore, existingEmpty bool) AdoptionDecision {
	if existingEmpty {
		return AdoptionDecision{
			ShouldAdopt:    true,
			ExistingScore:  0,
			NewScore:       newScore.Score,
			ExistingSource: "",
			NewSource:      newScore.Provider,
			Reason:         "empty field - always adopt",
		}
	}

	if newScore.Score > existingScore.Score {
		return AdoptionDecision{
			ShouldAdopt:    true,
			ExistingScore:  existingScore.Score,
			NewScore:       newScore.Score,
			ExistingSource: existingScore.Provider,
			NewSource:      newScore.Provider,
			Reason:         "new score higher",
		}
	}

	if newScore.Score == existingScore.Score {
		// Tiebreaker: use source trust rank
		existingTrust := sourceProviderTrustRank(existingScore.Provider)
		newTrust := sourceProviderTrustRank(newScore.Provider)

		if newTrust > existingTrust {
			return AdoptionDecision{
				ShouldAdopt:    true,
				ExistingScore:  existingScore.Score,
				NewScore:       newScore.Score,
				ExistingSource: existingScore.Provider,
				NewSource:      newScore.Provider,
				Reason:         "tie - new source more trusted",
			}
		}

		return AdoptionDecision{
			ShouldAdopt:    false,
			ExistingScore:  existingScore.Score,
			NewScore:       newScore.Score,
			ExistingSource: existingScore.Provider,
			NewSource:      newScore.Provider,
			Reason:         "tie - existing source equally or more trusted",
		}
	}

	return AdoptionDecision{
		ShouldAdopt:    false,
		ExistingScore:  existingScore.Score,
		NewScore:       newScore.Score,
		ExistingSource: existingScore.Provider,
		NewSource:      newScore.Provider,
		Reason:         "new score lower",
	}
}

// sourceProviderTrustRank returns a trust ranking for tiebreaking.
// Higher number = more trusted source.
func sourceProviderTrustRank(provider string) int {
	// This matches the existing hierarchy in persistence.go:providerTrustRank
	// but extracted here for reuse
	switch provider {
	case "wikidata":
		return 5
	case "wordnet":
		return 4
	case "llm":
		return 3
	case "ecdict":
		return 2
	case "conceptnet":
		return 1
	default:
		return 0
	}
}

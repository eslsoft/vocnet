package pipeline

import (
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

// RuleBasedScorer implements FieldScorer using deterministic rules.
// Scores are based on field completeness, validity, and richness.
type RuleBasedScorer struct{}

// NewRuleBasedScorer creates a new rule-based field scorer.
func NewRuleBasedScorer() *RuleBasedScorer {
	return &RuleBasedScorer{}
}

// ScoreLexeme computes quality score for a lexeme (0-100).
// Scoring breakdown:
//   - Base: 40 points
//   - +20 if valid POS (not "unspecified")
//   - +20 if has senses (glosses/definitions)
//   - +10 if has categories
//   - +10 if has ExternalID (especially Wikidata L-number)
func (s *RuleBasedScorer) ScoreLexeme(lex *entity.Lexeme, provider string) FieldScore {
	if lex == nil {
		return FieldScore{Score: 0, Provider: provider, Reason: "nil lexeme"}
	}

	score := 40.0

	// Valid POS
	if lex.PartOfSpeech != entity.PartOfSpeechUnspecified {
		score += 20
	}

	// Has senses
	if len(lex.Senses) > 0 {
		score += 20
	}

	// Has categories
	if len(lex.Categories) > 0 {
		score += 10
	}

	// Has ExternalID (bonus for Wikidata)
	if lex.ExternalID != "" {
		score += 10
		// Wikidata L-numbers get slight preference
		if strings.HasPrefix(lex.ExternalID, "L") {
			score += 5
		}
	}

	// Cap at 100
	if score > 100 {
		score = 100
	}

	return FieldScore{
		Score:      score,
		Provider:   provider,
		Confidence: 1.0,
		Reason:     "rule-based lexeme scoring",
	}
}

// ScoreForm computes quality score for a lemma form (0-100).
// Scoring breakdown:
//   - Base: 50 points
//   - +25 if has phonetics
//   - +25 if has syllables
func (s *RuleBasedScorer) ScoreForm(form *entity.LemmaForm, provider string) FieldScore {
	if form == nil {
		return FieldScore{Score: 0, Provider: provider, Reason: "nil form"}
	}

	score := 50.0

	// Has phonetics
	if len(form.Phonetics) > 0 {
		score += 25
	}

	// Has syllables
	if len(form.Syllables) > 0 {
		score += 25
	}

	return FieldScore{
		Score:      score,
		Provider:   provider,
		Confidence: 1.0,
		Reason:     "rule-based form scoring",
	}
}

// ScoreLemmaField computes quality score for lemma-level fields.
// Supported fields: "level", "frequencies", "syllables"
func (s *RuleBasedScorer) ScoreLemmaField(fieldName string, value any, provider string) FieldScore {
	switch fieldName {
	case "level":
		return s.scoreLevelField(value, provider)
	case "frequencies":
		return s.scoreFrequenciesField(value, provider)
	case "syllables":
		return s.scoreSyllablesField(value, provider)
	default:
		return FieldScore{
			Score:      0,
			Provider:   provider,
			Confidence: 0,
			Reason:     "unsupported field: " + fieldName,
		}
	}
}

// scoreLevelField scores CEFR level field.
// Lower levels (more fundamental) get higher scores.
// A1=100, A2=90, B1=80, B2=70, C1=60, C2=50, Unknown=0
func (s *RuleBasedScorer) scoreLevelField(value any, provider string) FieldScore {
	level, ok := value.(string)
	if !ok || level == "" {
		return FieldScore{Score: 0, Provider: provider, Reason: "empty level"}
	}

	score := 0.0
	switch strings.ToUpper(level) {
	case "A1":
		score = 100
	case "A2":
		score = 90
	case "B1":
		score = 80
	case "B2":
		score = 70
	case "C1":
		score = 60
	case "C2":
		score = 50
	default:
		score = 0
	}

	return FieldScore{
		Score:      score,
		Provider:   provider,
		Confidence: 1.0,
		Reason:     "CEFR level: " + level,
	}
}

// scoreFrequenciesField scores frequency data.
// More corpus sources = better. Score = min(count * 10, 100)
func (s *RuleBasedScorer) scoreFrequenciesField(value any, provider string) FieldScore {
	freqs, ok := value.([]entity.Frequency)
	if !ok || len(freqs) == 0 {
		return FieldScore{Score: 0, Provider: provider, Reason: "no frequencies"}
	}

	score := float64(len(freqs)) * 10
	if score > 100 {
		score = 100
	}

	return FieldScore{
		Score:      score,
		Provider:   provider,
		Confidence: 1.0,
		Reason:     "frequency count",
	}
}

// scoreSyllablesField scores syllable data.
// Binary: 100 if present, 0 if absent
func (s *RuleBasedScorer) scoreSyllablesField(value any, provider string) FieldScore {
	syllables, ok := value.([]string)
	if !ok || len(syllables) == 0 {
		return FieldScore{Score: 0, Provider: provider, Reason: "no syllables"}
	}

	return FieldScore{
		Score:      100,
		Provider:   provider,
		Confidence: 1.0,
		Reason:     "syllables present",
	}
}

// ScoreRelation computes quality score for a semantic relation (0-100).
// Scoring breakdown:
//   - Base: 30 points
//   - +30 if target is resolved (has TargetLexemeID or valid TargetRef)
//   - +20 if sense-mapped
//   - +20 if strength is in valid range [0, 1]
func (s *RuleBasedScorer) ScoreRelation(rel *entity.SemanticRelation) FieldScore {
	if rel == nil {
		return FieldScore{Score: 0, Provider: "", Reason: "nil relation"}
	}

	score := 30.0

	// Target resolved
	if rel.TargetLexemeID != nil || strings.TrimSpace(rel.TargetRef) != "" {
		score += 30
	}

	// Sense-mapped
	if rel.SenseMapped {
		score += 20
	}

	// Valid strength range
	if rel.Strength >= 0 && rel.Strength <= 1 {
		score += 20
	}

	return FieldScore{
		Score:      score,
		Provider:   rel.Provider,
		Confidence: 1.0,
		Reason:     "rule-based relation scoring",
	}
}

package scoring

import (
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

// ProcessStatus indicates the outcome of a processor execution.
type ProcessStatus int

const (
	ProcessStatusExecuted ProcessStatus = iota
	ProcessStatusNoData                 // Ran but source had no data
)

// ProcessResult contains the outputs of a single processor execution.
type ProcessResult struct {
	Status        ProcessStatus
	Evidence      []*entity.RawEvidence
	Lexemes       []*entity.Lexeme
	Relations     []*entity.SemanticRelation
	Forms         []*entity.LemmaForm
	FormsByLexeme map[string][]*entity.LemmaForm // forms grouped by Lexeme ExternalID
	LemmaUpdate   *entity.Lemma                  // non-nil → update lemma
	LemmaSnapshot *entity.LemmaSnapshot          // only set by LemmaSnapshotProcessor
	Provider      string                         // source provider name (for evaluator)
}

// --- Scorer interface and types ---

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
		existingTrust := SourceProviderTrustRank(existingScore.Provider)
		newTrust := SourceProviderTrustRank(newScore.Provider)

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

// SourceProviderTrustRank returns a trust ranking for tiebreaking.
// Higher number = more trusted source.
func SourceProviderTrustRank(provider string) int {
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

// --- RuleBasedScorer implementation ---

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

// FieldFragment represents a single field's data with its quality score.
type FieldFragment struct {
	Type     string     // e.g., "lexeme", "form.phonetics", "metadata.level"
	Data     any        // The actual data
	Score    FieldScore // Quality assessment
	Provider string     // Data source name
}

// EvaluatedFragments holds all evaluated fragments from a single source.
type EvaluatedFragments struct {
	Provider  string
	Fragments map[string]*FieldFragment // key: field key like "lexeme:en:verb" or "form:run:phonetics"
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

package pipeline

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

// DataEvaluator orchestrates field-level evaluation and adoption decisions.
// It uses a FieldScorer to determine if new data should replace existing data.
type DataEvaluator struct {
	scorer FieldScorer
	logger *slog.Logger
}

// NewDataEvaluator creates a new data evaluator with the given scorer.
func NewDataEvaluator(scorer FieldScorer, logger *slog.Logger) *DataEvaluator {
	return &DataEvaluator{
		scorer: scorer,
		logger: logger,
	}
}

// EvaluateAndMergeLexemes merges new lexemes into existing list with scoring.
// Returns the merged list and adoption decisions for logging.
//
// Matching Strategy:
// 1. ExternalID-based matching: For sources with unique identifiers (Wikidata)
// 2. POS-based matching: For sources without ExternalID (ECDICT, some WordNet data)
func (e *DataEvaluator) EvaluateAndMergeLexemes(
	existing []*entity.Lexeme,
	new []*entity.Lexeme,
	newProvider string,
) ([]*entity.Lexeme, []AdoptionDecision) {
	if len(new) == 0 {
		return existing, nil
	}

	// Build matching indices
	byExtID := make(map[string]int)      // ExternalID → index in existing
	byLangPOS := make(map[string]int)    // "language:pos" → index in existing

	for i, lex := range existing {
		if lex.ExternalID != "" {
			byExtID[lex.ExternalID] = i
		}
		// Always build POS index - needed for ECDICT-style sources to match with Wikidata
		key := lex.Language.Code() + ":" + string(lex.PartOfSpeech)
		// Use the first lexeme found for this language:pos combination
		if _, exists := byLangPOS[key]; !exists {
			byLangPOS[key] = i
		}
	}

	var decisions []AdoptionDecision

	for _, newLex := range new {
		var matchedIdx int
		var found bool
		var matchType string

		// Strategy 1: Try ExternalID matching first (for Wikidata-like sources)
		if newLex.ExternalID != "" {
			if idx, ok := byExtID[newLex.ExternalID]; ok {
				matchedIdx, found, matchType = idx, true, "external_id"
			}
		} else {
			// Strategy 2: POS-based matching for sources without ExternalID (ECDICT-like)
			key := newLex.Language.Code() + ":" + string(newLex.PartOfSpeech)
			if idx, ok := byLangPOS[key]; ok {
				matchedIdx, found, matchType = idx, true, "language_pos"
			}
		}

		if found {
			// Always merge fields when lexemes match (don't use conflict evaluation)
			existingLex := existing[matchedIdx]
			enriched := e.mergeLexemeFields(existingLex, newLex)
			existing[matchedIdx] = enriched

			decisions = append(decisions, AdoptionDecision{
				ShouldAdopt: true,
				NewScore:    e.scorer.ScoreLexeme(newLex, newProvider).Score,
				NewSource:   newProvider,
				Reason:      fmt.Sprintf("merged fields (matched by %s)", matchType),
			})
		} else {
			// No conflict: always adopt new lexeme
			existing = append(existing, newLex)

			// Update indices for future matching
			if newLex.ExternalID != "" {
				byExtID[newLex.ExternalID] = len(existing) - 1
			} else {
				key := newLex.Language.Code() + ":" + string(newLex.PartOfSpeech)
				if _, exists := byLangPOS[key]; !exists {
					byLangPOS[key] = len(existing) - 1
				}
			}

			decisions = append(decisions, AdoptionDecision{
				ShouldAdopt: true,
				NewScore:    e.scorer.ScoreLexeme(newLex, newProvider).Score,
				NewSource:   newProvider,
				Reason:      "new lexeme - no conflict",
			})
		}
	}

	return existing, decisions
}

// mergeLexemeFields intelligently merges fields from new lexeme into existing.
// Uses field-level scoring to decide which fields to adopt.
func (e *DataEvaluator) mergeLexemeFields(existing, new *entity.Lexeme) *entity.Lexeme {
	merged := *existing

	// Senses: merge with deduplication
	if len(new.Senses) > 0 {
		merged.Senses = e.mergeSenses(existing.Senses, new.Senses)
	}

	// Categories: merge with deduplication
	if len(new.Categories) > 0 {
		merged.Categories = e.mergeCategories(existing.Categories, new.Categories)
	}

	// POS: adopt if existing is unspecified
	if existing.PartOfSpeech == entity.PartOfSpeechUnspecified && new.PartOfSpeech != entity.PartOfSpeechUnspecified {
		merged.PartOfSpeech = new.PartOfSpeech
	}

	// SenseGloss: adopt if empty
	if existing.SenseGloss == "" && new.SenseGloss != "" {
		merged.SenseGloss = new.SenseGloss
	}

	// ExternalID: prefer Wikidata L-numbers
	if new.ExternalID != "" {
		if existing.ExternalID == "" {
			merged.ExternalID = new.ExternalID
		} else if strings.HasPrefix(new.ExternalID, "L") && !strings.HasPrefix(existing.ExternalID, "L") {
			merged.ExternalID = new.ExternalID
		}
	}

	// Completeness: use higher value
	if new.Completeness > existing.Completeness {
		merged.Completeness = new.Completeness
	}

	return &merged
}

// mergeSenses combines senses, avoiding duplicates by language+gloss.
func (e *DataEvaluator) mergeSenses(existing, new []entity.LexemeSense) []entity.LexemeSense {
	seen := make(map[string]struct{})
	result := make([]entity.LexemeSense, 0, len(existing)+len(new))

	for _, sense := range existing {
		key := sense.Language.Code() + ":" + sense.Gloss
		if _, ok := seen[key]; !ok {
			result = append(result, sense)
			seen[key] = struct{}{}
		}
	}

	for _, sense := range new {
		key := sense.Language.Code() + ":" + sense.Gloss
		if _, ok := seen[key]; !ok {
			result = append(result, sense)
			seen[key] = struct{}{}
		}
	}

	return result
}

// mergeCategories combines categories, avoiding duplicates.
func (e *DataEvaluator) mergeCategories(existing, new []string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0, len(existing)+len(new))

	for _, cat := range existing {
		if cat != "" {
			if _, ok := seen[cat]; !ok {
				result = append(result, cat)
				seen[cat] = struct{}{}
			}
		}
	}

	for _, cat := range new {
		if cat != "" {
			if _, ok := seen[cat]; !ok {
				result = append(result, cat)
				seen[cat] = struct{}{}
			}
		}
	}

	return result
}

// EvaluateAndMergeForms merges new forms into existing list with scoring.
func (e *DataEvaluator) EvaluateAndMergeForms(
	existing []*entity.LemmaForm,
	new []*entity.LemmaForm,
	newProvider string,
) ([]*entity.LemmaForm, []AdoptionDecision) {
	if len(new) == 0 {
		return existing, nil
	}

	index := make(map[string]int) // surface:formType → index
	for i, f := range existing {
		key := formKey(f)
		index[key] = i
	}

	var decisions []AdoptionDecision

	for _, newForm := range new {
		key := formKey(newForm)
		if idx, ok := index[key]; ok {
			// Conflict: evaluate enrichment fields
			existingForm := existing[idx]
			decision := e.evaluateFormConflict(existingForm, newForm, newProvider)
			decisions = append(decisions, decision)

			if decision.ShouldAdopt {
				// Merge enrichment fields
				e.mergeFormFields(existingForm, newForm)
			}
		} else {
			// No conflict: add new form
			existing = append(existing, newForm)
			index[key] = len(existing) - 1
			decisions = append(decisions, AdoptionDecision{
				ShouldAdopt: true,
				NewScore:    e.scorer.ScoreForm(newForm, newProvider).Score,
				NewSource:   newProvider,
				Reason:      "new form - no conflict",
			})
		}
	}

	return existing, decisions
}

// evaluateFormConflict decides whether to enrich existing form with new data.
func (e *DataEvaluator) evaluateFormConflict(
	existing *entity.LemmaForm,
	new *entity.LemmaForm,
	newProvider string,
) AdoptionDecision {
	existingProvider := e.inferFormProvider(existing)
	existingScore := e.scorer.ScoreForm(existing, existingProvider)
	newScore := e.scorer.ScoreForm(new, newProvider)

	return DecideAdoption(existingScore, newScore, false)
}

// mergeFormFields enriches dst with non-empty fields from src.
func (e *DataEvaluator) mergeFormFields(dst, src *entity.LemmaForm) {
	// Syllables: adopt if empty
	if len(src.Syllables) > 0 && len(dst.Syllables) == 0 {
		dst.Syllables = src.Syllables
	}

	// Phonetics: merge with deduplication
	if len(src.Phonetics) > 0 {
		dst.Phonetics = e.mergePhonetics(dst.Phonetics, src.Phonetics)
	}

	// IsIrregular: adopt if true
	if src.IsIrregular && !dst.IsIrregular {
		dst.IsIrregular = true
	}
}

// mergePhonetics appends new phonetics that don't already exist.
func (e *DataEvaluator) mergePhonetics(existing, incoming []entity.Phonetic) []entity.Phonetic {
	seen := make(map[string]struct{}, len(existing))
	for _, ph := range existing {
		seen[ph.IPA+"|"+ph.Dialect] = struct{}{}
	}
	for _, ph := range incoming {
		key := ph.IPA + "|" + ph.Dialect
		if _, ok := seen[key]; !ok {
			existing = append(existing, ph)
			seen[key] = struct{}{}
		}
	}
	return existing
}

// EvaluateAndMergeLemmaUpdate evaluates lemma-level field updates.
// Returns whether to apply the update and the enriched lemma.
func (e *DataEvaluator) EvaluateAndMergeLemmaUpdate(
	existing *entity.Lemma,
	update *entity.Lemma,
	newProvider string,
) (*entity.Lemma, []AdoptionDecision) {
	if update == nil {
		return existing, nil
	}

	merged := *existing
	var decisions []AdoptionDecision

	// Level: evaluate by CEFR scoring
	if update.Level != "" {
		existingEmpty := existing.Level == ""
		existingScore := e.scorer.ScoreLemmaField("level", existing.Level, "")
		newScore := e.scorer.ScoreLemmaField("level", update.Level, newProvider)
		decision := DecideAdoption(existingScore, newScore, existingEmpty)
		decisions = append(decisions, decision)

		if decision.ShouldAdopt {
			merged.Level = update.Level
		}
	}

	// Frequencies: merge by corpus
	if len(update.Frequencies) > 0 {
		aggregator := &DataAggregator{}
		merged.Frequencies = aggregator.MergeFrequencies(existing.Frequencies, update.Frequencies)
		decisions = append(decisions, AdoptionDecision{
			ShouldAdopt: true,
			NewSource:   newProvider,
			Reason:      "frequencies merged by corpus",
		})
	}

	// Syllables: adopt if empty
	if len(update.Syllables) > 0 && len(existing.Syllables) == 0 {
		merged.Syllables = update.Syllables
		decisions = append(decisions, AdoptionDecision{
			ShouldAdopt: true,
			NewSource:   newProvider,
			Reason:      "syllables - was empty",
		})
	}

	return &merged, decisions
}

// inferFormProvider attempts to infer the provider from form metadata.
// Forms with syllables likely come from Moby; forms with IPA likely from Wikidata or ECDICT.
func (e *DataEvaluator) inferFormProvider(f *entity.LemmaForm) string {
	if f == nil {
		return ""
	}
	// If form has syllables but no phonetics, likely from Moby
	if len(f.Syllables) > 0 && len(f.Phonetics) == 0 {
		return "moby"
	}
	// If form has IPA with en-GB dialect, likely from ECDICT
	for _, ph := range f.Phonetics {
		if ph.Dialect == "en-GB" {
			return "ecdict"
		}
	}
	return ""
}

package pipeline

import (
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
func (e *DataEvaluator) EvaluateAndMergeLexemes(
	existing []*entity.Lexeme,
	new []*entity.Lexeme,
	newProvider string,
) ([]*entity.Lexeme, []AdoptionDecision) {
	if len(new) == 0 {
		return existing, nil
	}

	byExtID := make(map[string]int) // ExternalID → index in existing
	for i, lex := range existing {
		if lex.ExternalID != "" {
			byExtID[lex.ExternalID] = i
		}
	}

	var decisions []AdoptionDecision

	for _, newLex := range new {
		// Try to match by ExternalID
		if newLex.ExternalID != "" {
			if idx, ok := byExtID[newLex.ExternalID]; ok {
				// Conflict: evaluate which to keep
				existingLex := existing[idx]
				decision := e.evaluateLexemeConflict(existingLex, newLex, newProvider)
				decisions = append(decisions, decision)

				if decision.ShouldAdopt {
					// Merge: keep ID, update fields
					enriched := e.mergeLexemeFields(existingLex, newLex)
					existing[idx] = enriched
				}
				continue
			}
		}

		// No conflict: always adopt new lexeme
		existing = append(existing, newLex)
		decisions = append(decisions, AdoptionDecision{
			ShouldAdopt: true,
			NewScore:    e.scorer.ScoreLexeme(newLex, newProvider).Score,
			NewSource:   newProvider,
			Reason:      "new lexeme - no conflict",
		})
	}

	return existing, decisions
}

// evaluateLexemeConflict decides whether to replace existing lexeme with new one.
func (e *DataEvaluator) evaluateLexemeConflict(
	existing *entity.Lexeme,
	new *entity.Lexeme,
	newProvider string,
) AdoptionDecision {
	existingProvider := e.inferLexemeProvider(existing)
	existingScore := e.scorer.ScoreLexeme(existing, existingProvider)
	newScore := e.scorer.ScoreLexeme(new, newProvider)

	return DecideAdoption(existingScore, newScore, false)
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

// inferLexemeProvider attempts to infer the provider from lexeme metadata.
func (e *DataEvaluator) inferLexemeProvider(lex *entity.Lexeme) string {
	if lex == nil {
		return ""
	}
	// ExternalID pattern matching
	if strings.HasPrefix(lex.ExternalID, "L") {
		return "wikidata"
	}
	if strings.HasPrefix(lex.ExternalID, "wn:") || strings.HasPrefix(lex.ExternalID, "synset:") {
		return "wordnet"
	}
	// ECDICT lexemes have Chinese senses and no ExternalID
	if lex.ExternalID == "" && len(lex.Senses) > 0 {
		for _, s := range lex.Senses {
			if s.Language == entity.LanguageChinese {
				return "ecdict"
			}
		}
	}
	return ""
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

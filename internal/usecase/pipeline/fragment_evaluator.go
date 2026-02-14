package pipeline

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eslsoft/vocnet/internal/entity"
)

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

// FragmentEvaluator evaluates the quality of data fragments from sources.
type FragmentEvaluator struct {
	scorer *RuleBasedScorer
	logger *slog.Logger
}

// NewFragmentEvaluator creates a new FragmentEvaluator.
func NewFragmentEvaluator(scorer *RuleBasedScorer, logger *slog.Logger) *FragmentEvaluator {
	return &FragmentEvaluator{
		scorer: scorer,
		logger: logger,
	}
}

// Name implements the Processor interface.
func (fe *FragmentEvaluator) Name() string {
	return "fragment_evaluator"
}

// Process evaluates all fragments in the pipeline context.
func (fe *FragmentEvaluator) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	// Group evidence by provider
	evidenceByProvider := make(map[string][]*entity.RawEvidence)
	for _, ev := range pctx.Evidence {
		evidenceByProvider[ev.Provider] = append(evidenceByProvider[ev.Provider], ev)
	}

	// Also collect providers from ProcessResults (for LemmaUpdate, etc.)
	allProviders := make(map[string]bool)
	for provider := range evidenceByProvider {
		allProviders[provider] = true
	}
	for _, result := range pctx.ProcessResults {
		if result.Provider != "" {
			allProviders[result.Provider] = true
		}
	}

	// Evaluate fragments from each provider
	allFragments := make(map[string][]*FieldFragment) // key: fieldKey, value: competing fragments

	for provider := range allProviders {
		evaluated := fe.evaluateProvider(pctx, provider)

		// Merge into global fragments map
		for fieldKey, fragment := range evaluated.Fragments {
			allFragments[fieldKey] = append(allFragments[fieldKey], fragment)
		}
	}

	fe.logger.Info("fragment evaluation completed",
		"providers", len(allProviders),
		"unique_fields", len(allFragments))

	// Store evaluated fragments in context for integration phase
	if pctx.EvaluatedFragments == nil {
		pctx.EvaluatedFragments = make(map[string][]*FieldFragment)
	}
	pctx.EvaluatedFragments = allFragments

	return &ProcessResult{
		Status: ProcessStatusExecuted,
	}, nil
}

// evaluateProvider evaluates all fragments from a single provider.
func (fe *FragmentEvaluator) evaluateProvider(pctx *PipelineContext, provider string) *EvaluatedFragments {
	evaluated := &EvaluatedFragments{
		Provider:  provider,
		Fragments: make(map[string]*FieldFragment),
	}

	// Evaluate lexemes
	for _, lexeme := range pctx.Lexemes {
		if lexeme == nil {
			continue
		}
		// Only evaluate lexemes if at least one sense came from this provider
		fromProvider := false
		for _, s := range lexeme.Senses {
			if s.Provider == provider {
				fromProvider = true
				break
			}
		}
		if !fromProvider {
			continue
		}

		key := fmt.Sprintf("lexeme:%s:%s", lexeme.Language, lexeme.PartOfSpeech)
		score := fe.scorer.ScoreLexeme(lexeme, provider)
		evaluated.Fragments[key] = &FieldFragment{
			Type:     "lexeme",
			Data:     lexeme,
			Score:    score,
			Provider: provider,
		}
	}

	// Evaluate forms by field
	for _, form := range pctx.Forms {
		if form == nil {
			continue
		}

		surface := form.Surface

		// Evaluate phonetics
		hasProviderPhonetics := false
		var providerPhonetics []entity.Phonetic
		for _, ph := range form.Phonetics {
			if ph.Provider == provider {
				hasProviderPhonetics = true
				providerPhonetics = append(providerPhonetics, ph)
			}
		}

		if hasProviderPhonetics {
			key := fmt.Sprintf("form:%s:phonetics", surface)
			score := fe.scorer.ScoreForm(form, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "form.phonetics",
				Data:     providerPhonetics,
				Score:    score,
				Provider: provider,
			}
		}

		// Evaluate syllables (check if form itself came from this provider if we had a field,
		// but since it's shared, we use syllables presence as a hint if we can't be sure)
		if len(form.Syllables) > 0 {
			// Note: Syllables currently don't have a per-field provider,
			// so we still have a bit of a legacy "hint" here, but phonetics are now precise.
			key := fmt.Sprintf("form:%s:syllables", surface)
			score := fe.scorer.ScoreForm(form, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "form.syllables",
				Data:     form.Syllables,
				Score:    score,
				Provider: provider,
			}
		}
	}

	// Evaluate relations
	for _, relation := range pctx.Relations {
		if relation == nil || relation.Provider != provider {
			continue
		}
		// Relations are already deduplicated, and now we only score those belonging to the provider
		key := fmt.Sprintf("relation:%s:%s:%s", relation.RelationType, relation.TargetRef, relation.Provider)
		score := fe.scorer.ScoreRelation(relation)
		evaluated.Fragments[key] = &FieldFragment{
			Type:     "relation",
			Data:     relation,
			Score:    score,
			Provider: provider,
		}
	}

	// Evaluate lemma metadata updates from this provider
	fe.evaluateLemmaUpdates(pctx, provider, evaluated)

	return evaluated
}

// evaluateLemmaUpdates extracts and evaluates metadata fields from processed results
// that originated from this provider (CEFR levels, frequencies, syllables).
func (fe *FragmentEvaluator) evaluateLemmaUpdates(pctx *PipelineContext, provider string, evaluated *EvaluatedFragments) {
	// Look through all process results to find LemmaUpdates from this provider
	for _, result := range pctx.ProcessResults {
		if result.Provider != provider || result.LemmaUpdate == nil {
			continue
		}

		update := result.LemmaUpdate

		// Evaluate CEFR level
		if update.Level != "" {
			key := "metadata.level"
			score := fe.scorer.ScoreLemmaField("level", update.Level, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "metadata.level",
				Data:     update.Level,
				Score:    score,
				Provider: provider,
			}
		}

		// Evaluate frequencies
		if len(update.Frequencies) > 0 {
			key := "metadata.frequencies"
			score := fe.scorer.ScoreLemmaField("frequencies", update.Frequencies, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "metadata.frequencies",
				Data:     update.Frequencies,
				Score:    score,
				Provider: provider,
			}
		}

		// Evaluate syllables
		if len(update.Syllables) > 0 {
			key := "metadata.syllables"
			score := fe.scorer.ScoreLemmaField("syllables", update.Syllables, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "metadata.syllables",
				Data:     update.Syllables,
				Score:    score,
				Provider: provider,
			}
		}
	}
}

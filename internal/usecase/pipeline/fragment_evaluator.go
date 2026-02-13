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

	// Evaluate fragments from each provider
	allFragments := make(map[string][]*FieldFragment) // key: fieldKey, value: competing fragments

	for provider := range evidenceByProvider {
		evaluated := fe.evaluateProvider(pctx, provider)

		// Merge into global fragments map
		for fieldKey, fragment := range evaluated.Fragments {
			allFragments[fieldKey] = append(allFragments[fieldKey], fragment)
		}
	}

	fe.logger.Info("fragment evaluation completed",
		"providers", len(evidenceByProvider),
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
		// Only evaluate lexemes from this provider
		// (We need to add provider tracking to Lexeme entity)
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
		if len(form.Phonetics) > 0 {
			key := fmt.Sprintf("form:%s:phonetics", surface)
			score := fe.scorer.ScoreForm(form, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "form.phonetics",
				Data:     form.Phonetics,
				Score:    score,
				Provider: provider,
			}
		}

		// Evaluate syllables
		if len(form.Syllables) > 0 {
			key := fmt.Sprintf("form:%s:syllables", surface)
			score := fe.scorer.ScoreForm(form, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "form.syllables",
				Data:     form.Syllables,
				Score:    score,
				Provider: provider,
			}
		}

		// Evaluate form type
		if form.FormType != entity.FormTypeUnspecified {
			key := fmt.Sprintf("form:%s:type", surface)
			score := fe.scorer.ScoreForm(form, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "form.type",
				Data:     form.FormType,
				Score:    score,
				Provider: provider,
			}
		}
	}

	// Evaluate lemma metadata
	if pctx.Lemma != nil {
		if pctx.Lemma.Level != "" {
			key := "metadata:level"
			score := fe.scorer.ScoreLemmaField("level", pctx.Lemma.Level, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "metadata.level",
				Data:     pctx.Lemma.Level,
				Score:    score,
				Provider: provider,
			}
		}

		if len(pctx.Lemma.Frequencies) > 0 {
			key := "metadata:frequencies"
			score := fe.scorer.ScoreLemmaField("frequencies", pctx.Lemma.Frequencies, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "metadata.frequencies",
				Data:     pctx.Lemma.Frequencies,
				Score:    score,
				Provider: provider,
			}
		}

		if len(pctx.Lemma.Syllables) > 0 {
			key := "metadata:syllables"
			score := fe.scorer.ScoreLemmaField("syllables", pctx.Lemma.Syllables, provider)
			evaluated.Fragments[key] = &FieldFragment{
				Type:     "metadata.syllables",
				Data:     pctx.Lemma.Syllables,
				Score:    score,
				Provider: provider,
			}
		}
	}

	// Evaluate relations
	for _, relation := range pctx.Relations {
		if relation == nil {
			continue
		}
		// Relations are already deduplicated, so use unique key
		key := fmt.Sprintf("relation:%s:%s:%s", relation.RelationType, relation.TargetRef, relation.Provider)
		score := fe.scorer.ScoreRelation(relation)
		evaluated.Fragments[key] = &FieldFragment{
			Type:     "relation",
			Data:     relation,
			Score:    score,
			Provider: provider,
		}
	}

	return evaluated
}

package integration

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
)

// DataProvenance records the source and quality of an integrated field.
type DataProvenance struct {
	Provider     string              // Which provider supplied this data
	Score        scoring.FieldScore  // Quality score
	Timestamp    time.Time           // When it was integrated
	Alternatives int                 // How many candidates were rejected
}

// IntegrationProcessor merges fragments based on quality scores.
type IntegrationProcessor struct {
	logger *slog.Logger
}

// NewIntegrationProcessor creates a new integration processor.
func NewIntegrationProcessor(logger *slog.Logger) *IntegrationProcessor {
	return &IntegrationProcessor{
		logger: logger,
	}
}

// Name implements the Processor interface.
func (ip *IntegrationProcessor) Name() string {
	return "integration"
}

// Process performs smart field-level merging based on quality scores.
func (ip *IntegrationProcessor) Process(ctx context.Context, pctx *pipeline.PipelineContext) (*scoring.ProcessResult, error) {
	if len(pctx.EvaluatedFragments) == 0 {
		ip.logger.Warn("no evaluated fragments to integrate")
		return &scoring.ProcessResult{Status: scoring.ProcessStatusExecuted}, nil
	}

	// Track provenance for each field
	provenance := make(map[string]*DataProvenance)

	// Integrate each field type
	integratedLexemes := ip.integrateLexemes(pctx.EvaluatedFragments, provenance)
	integratedForms := ip.integrateForms(pctx.EvaluatedFragments, pctx.Forms, provenance)
	integratedLemmaData := ip.integrateLemmaMetadata(pctx.EvaluatedFragments, provenance)
	integratedRelations := ip.integrateRelations(pctx.EvaluatedFragments, provenance)

	ip.logger.Info("integration completed",
		"lexemes", len(integratedLexemes),
		"forms", len(integratedForms),
		"relations", len(integratedRelations),
		"provenance_entries", len(provenance))

	// Clear old context data and replace with integrated results
	pctx.Lexemes = integratedLexemes
	pctx.Forms = integratedForms
	pctx.Relations = integratedRelations

	// Update lemma with integrated metadata
	if integratedLemmaData != nil {
		if pctx.Lemma == nil {
			pctx.Lemma = &entity.Lemma{}
		}
		if integratedLemmaData.Level != "" {
			pctx.Lemma.Level = integratedLemmaData.Level
		}
		if len(integratedLemmaData.Frequencies) > 0 {
			pctx.Lemma.Frequencies = integratedLemmaData.Frequencies
		}
		if len(integratedLemmaData.Syllables) > 0 {
			pctx.Lemma.Syllables = integratedLemmaData.Syllables
		}
	}

	return &scoring.ProcessResult{
		Status:    scoring.ProcessStatusExecuted,
		Lexemes:   integratedLexemes,
		Forms:     integratedForms,
		Relations: integratedRelations,
	}, nil
}

// integrateLexemes selects the best lexeme for each language+POS combination.
func (ip *IntegrationProcessor) integrateLexemes(
	fragments map[string][]*scoring.FieldFragment,
	provenance map[string]*DataProvenance,
) []*entity.Lexeme {
	var result []*entity.Lexeme

	for key, candidates := range fragments {
		if len(candidates) == 0 {
			continue
		}

		// Only process lexeme fragments
		if candidates[0].Type != "lexeme" {
			continue
		}

		// Sort by score descending
		sort.Slice(candidates, func(i, j int) bool {
			return candidates[i].Score.Score > candidates[j].Score.Score
		})

		// Select winner
		winner := candidates[0]
		lexeme, ok := winner.Data.(*entity.Lexeme)
		if !ok {
			ip.logger.Warn("invalid lexeme data type", "key", key)
			continue
		}

		result = append(result, lexeme)

		// Record provenance
		provenance[key] = &DataProvenance{
			Provider:     winner.Provider,
			Score:        winner.Score,
			Timestamp:    time.Now(),
			Alternatives: len(candidates) - 1,
		}

		if len(candidates) > 1 {
			ip.logger.Debug("lexeme integrated",
				"key", key,
				"winner", winner.Provider,
				"score", fmt.Sprintf("%.1f", winner.Score.Score),
				"rejected", len(candidates)-1)
		}
	}

	return result
}

// integrateForms merges form fragments field-by-field.
// It uses existingForms as the base to preserve FormType and other fields,
// then applies fragment updates for phonetics, syllables, etc.
func (ip *IntegrationProcessor) integrateForms(
	fragments map[string][]*scoring.FieldFragment,
	existingForms []*entity.LemmaForm,
	provenance map[string]*DataProvenance,
) []*entity.LemmaForm {
	existingBySurface := ip.indexExistingForms(existingForms)
	formBySurface := make(map[string]*entity.LemmaForm)

	for key, candidates := range fragments {
		if !isFormFragment(candidates) {
			continue
		}

		sort.Slice(candidates, func(i, j int) bool {
			return candidates[i].Score.Score > candidates[j].Score.Score
		})

		winner := candidates[0]
		surface := extractSurfaceFromKey(key)
		if surface == "" {
			continue
		}

		form := ip.ensureForm(formBySurface, existingBySurface, surface)
		ip.applyFormFragment(form, winner)

		provenance[key] = &DataProvenance{
			Provider:     winner.Provider,
			Score:        winner.Score,
			Timestamp:    time.Now(),
			Alternatives: len(candidates) - 1,
		}
	}

	ip.mergeMissingForms(formBySurface, existingBySurface)

	result := make([]*entity.LemmaForm, 0, len(formBySurface))
	for _, form := range formBySurface {
		result = append(result, form)
	}

	return result
}

func (ip *IntegrationProcessor) indexExistingForms(forms []*entity.LemmaForm) map[string]*entity.LemmaForm {
	index := make(map[string]*entity.LemmaForm)
	for _, f := range forms {
		if f != nil {
			if _, exists := index[f.Surface]; !exists {
				index[f.Surface] = f
			}
		}
	}
	return index
}

func isFormFragment(candidates []*scoring.FieldFragment) bool {
	if len(candidates) == 0 {
		return false
	}
	t := candidates[0].Type
	return t == "form.phonetics" || t == "form.syllables" || t == "form.type"
}

func (ip *IntegrationProcessor) ensureForm(
	current map[string]*entity.LemmaForm,
	existing map[string]*entity.LemmaForm,
	surface string,
) *entity.LemmaForm {
	if form, ok := current[surface]; ok {
		return form
	}

	var newForm *entity.LemmaForm
	if old, ok := existing[surface]; ok {
		newForm = &entity.LemmaForm{
			Surface:     old.Surface,
			Normalized:  old.Normalized,
			FormType:    old.FormType,
			IsIrregular: old.IsIrregular,
			Phonetics:   old.Phonetics,
			Syllables:   old.Syllables,
		}
	} else {
		newForm = &entity.LemmaForm{
			Surface:  surface,
			FormType: entity.FormTypeLemma,
		}
	}
	current[surface] = newForm
	return newForm
}

func (ip *IntegrationProcessor) applyFormFragment(form *entity.LemmaForm, winner *scoring.FieldFragment) {
	switch winner.Type {
	case "form.phonetics":
		if phonetics, ok := winner.Data.([]entity.Phonetic); ok {
			form.Phonetics = phonetics
		}
	case "form.syllables":
		if syllables, ok := winner.Data.([]string); ok {
			form.Syllables = syllables
		}
	case "form.type":
		if formType, ok := winner.Data.(entity.FormType); ok {
			form.FormType = formType
		}
	}
}

func (ip *IntegrationProcessor) mergeMissingForms(current map[string]*entity.LemmaForm, existing map[string]*entity.LemmaForm) {
	for surface, form := range existing {
		if _, exists := current[surface]; !exists {
			current[surface] = form
		}
	}
}

// integrateLemmaMetadata merges lemma-level metadata.
func (ip *IntegrationProcessor) integrateLemmaMetadata(
	fragments map[string][]*scoring.FieldFragment,
	provenance map[string]*DataProvenance,
) *entity.Lemma {
	result := &entity.Lemma{}

	for key, candidates := range fragments {
		if len(candidates) == 0 || candidates[0].Type != "metadata.level" &&
			candidates[0].Type != "metadata.frequencies" &&
			candidates[0].Type != "metadata.syllables" {
			continue
		}

		// Sort by score descending
		sort.Slice(candidates, func(i, j int) bool {
			return candidates[i].Score.Score > candidates[j].Score.Score
		})

		winner := candidates[0]

		// Apply metadata
		switch candidates[0].Type {
		case "metadata.level":
			if level, ok := winner.Data.(string); ok {
				result.Level = level
			}
		case "metadata.frequencies":
			if freq, ok := winner.Data.([]entity.Frequency); ok {
				result.Frequencies = freq
			}
		case "metadata.syllables":
			if syl, ok := winner.Data.([]string); ok {
				result.Syllables = syl
			}
		}

		// Record provenance
		provenance[key] = &DataProvenance{
			Provider:     winner.Provider,
			Score:        winner.Score,
			Timestamp:    time.Now(),
			Alternatives: len(candidates) - 1,
		}
	}

	return result
}

// integrateRelations selects the best relations.
func (ip *IntegrationProcessor) integrateRelations(
	fragments map[string][]*scoring.FieldFragment,
	provenance map[string]*DataProvenance,
) []*entity.SemanticRelation {
	var result []*entity.SemanticRelation

	for key, candidates := range fragments {
		if len(candidates) == 0 || candidates[0].Type != "relation" {
			continue
		}

		// Sort by score descending
		sort.Slice(candidates, func(i, j int) bool {
			return candidates[i].Score.Score > candidates[j].Score.Score
		})

		winner := candidates[0]
		if relation, ok := winner.Data.(*entity.SemanticRelation); ok {
			result = append(result, relation)

			// Record provenance
			provenance[key] = &DataProvenance{
				Provider:     winner.Provider,
				Score:        winner.Score,
				Timestamp:    time.Now(),
				Alternatives: len(candidates) - 1,
			}
		}
	}

	return result
}

// extractSurfaceFromKey extracts the surface form from a field key.
// Example: "form:run:phonetics" -> "run"
func extractSurfaceFromKey(key string) string {
	// Simple string parsing: split by colon
	parts := []rune(key)
	firstColon := -1
	secondColon := -1

	for i, r := range parts {
		if r == ':' {
			if firstColon == -1 {
				firstColon = i
			} else if secondColon == -1 {
				secondColon = i
				break
			}
		}
	}

	if firstColon != -1 && secondColon != -1 {
		return string(parts[firstColon+1 : secondColon])
	}

	return ""
}

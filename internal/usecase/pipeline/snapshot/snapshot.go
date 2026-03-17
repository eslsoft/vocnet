package snapshot

import (
	"context"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
)

// LemmaSnapshotProcessor builds the materialized lemma snapshot and calculates quality.
// It reads all data from PipelineContext — no DB queries.
type LemmaSnapshotProcessor struct {
	qualityCalculator *QualityScoreCalculator
}

// NewLemmaSnapshotProcessor creates a new LemmaSnapshotProcessor.
func NewLemmaSnapshotProcessor() *LemmaSnapshotProcessor {
	return &LemmaSnapshotProcessor{
		qualityCalculator: NewQualityScoreCalculator(),
	}
}

func (p *LemmaSnapshotProcessor) Name() string { return "snapshot" }

func (p *LemmaSnapshotProcessor) Process(ctx context.Context, pctx *pipeline.PipelineContext) (*scoring.ProcessResult, error) {
	// Build snapshot lexemes from context.
	snapshotLexemes := make([]entity.LemmaSnapshotLexeme, 0, len(pctx.Lexemes))
	for _, lex := range pctx.Lexemes {
		senses := make([]entity.LemmaSnapshotSense, 0, len(lex.Senses))
		for _, s := range lex.Senses {
			senses = append(senses, entity.LemmaSnapshotSense{
				Language:    s.Language.Code(),
				Gloss:       s.Gloss,
				Examples:    extractExampleTexts(s.Examples),
				Provider:    s.Provider,
				TrustWeight: 0.8,
			})
		}

		language := pctx.Language.Code()
		if lex.Language != "" {
			language = lex.Language.Code()
		}

		snapshotLexemes = append(snapshotLexemes, entity.LemmaSnapshotLexeme{
			ExternalID: lex.ExternalID,
			Language:   language,
			POS:        string(lex.PartOfSpeech),
			Senses:     senses,
		})
	}

	// Build snapshot relations from context.
	snapshotRelations := make([]entity.LemmaSnapshotRelation, 0, len(pctx.Relations))
	for _, rel := range pctx.Relations {
		snapshotRelations = append(snapshotRelations, entity.LemmaSnapshotRelation{
			RelationType:   rel.RelationType,
			TargetTerm:     rel.TargetTerm,
			TargetRef:      rel.TargetRef,
			Provider:       rel.Provider,
			Strength:       rel.Strength,
			SenseMapped:    rel.SenseMapped,
			TargetResolved: rel.TargetLexemeID != nil,
		})
	}

	var frequencies []entity.Frequency
	if pctx.Lemma != nil {
		frequencies = append([]entity.Frequency{}, pctx.Lemma.Frequencies...)
	}
	syllables := findLemmaSyllables(pctx)

	snapshotForms := collectSnapshotForms(pctx)
	snapshotCategories := collectSnapshotCategories(pctx.Lexemes)

	snapshotData := entity.LemmaSnapshotData{
		Lexemes:     snapshotLexemes,
		Forms:       snapshotForms,
		Categories:  snapshotCategories,
		Frequencies: frequencies,
		Relations:   snapshotRelations,
		Syllables:   syllables,
	}

	quality := p.qualityCalculator.Calculate(snapshotData)
	lexemeCount, senseCount, formCount, relationCount, providerCount := summarizeSnapshotData(snapshotData)

	now := time.Now()
	normalized := ""
	surface := ""
	level := ""
	if pctx.Lemma != nil {
		surface = strings.TrimSpace(pctx.Lemma.Surface)
		normalized = strings.ToLower(surface)
		level = pctx.Lemma.Level
	}

	snapshot := &entity.LemmaSnapshot{
		Surface:       surface,
		Normalized:    normalized,
		Level:         level,
		Language:      pctx.Language.Code(),
		Version:       1,
		SchemaVersion: 1,
		Payload:       snapshotData,
		Quality:       quality,
		LexemeCount:   lexemeCount,
		SenseCount:    senseCount,
		FormCount:     formCount,
		RelationCount: relationCount,
		ProviderCount: providerCount,
		SynthesizedAt: now,
	}

	return &scoring.ProcessResult{
		Status:        scoring.ProcessStatusExecuted,
		LemmaSnapshot: snapshot,
	}, nil
}

func summarizeSnapshotData(data entity.LemmaSnapshotData) (int32, int32, int32, int32, int32) {
	lexemeCount := int32(len(data.Lexemes))
	relationCount := int32(len(data.Relations))
	senseCount := int32(0)
	formCount := int32(0)
	providers := make(map[string]struct{})

	for _, lex := range data.Lexemes {
		senseCount += int32(len(lex.Senses))
	}
	formCount = int32(len(data.Forms))
	for _, rel := range data.Relations {
		provider := strings.ToLower(strings.TrimSpace(rel.Provider))
		if provider != "" {
			providers[provider] = struct{}{}
		}
	}

	return lexemeCount, senseCount, formCount, relationCount, int32(len(providers))
}

func extractExampleTexts(examples []entity.SenseExample) []string {
	texts := make([]string, 0, len(examples))
	for _, ex := range examples {
		texts = append(texts, ex.Text)
	}
	return texts
}

func collectSnapshotForms(pctx *pipeline.PipelineContext) []entity.LemmaSnapshotForm {
	if pctx == nil {
		return nil
	}

	var merged []*entity.LemmaForm
	merged = append(merged, pctx.Forms...)
	for _, forms := range pctx.FormsByLexeme {
		merged = append(merged, forms...)
	}

	lemmaSurface := ""
	if pctx.Lemma != nil {
		lemmaSurface = strings.ToLower(strings.TrimSpace(pctx.Lemma.Surface))
	}
	return toLemmaSnapshotForms(merged, lemmaSurface)
}

func collectSnapshotCategories(lexemes []*entity.Lexeme) []string {
	if len(lexemes) == 0 {
		return nil
	}
	seen := make(map[string]struct{})
	out := make([]string, 0)
	for _, lex := range lexemes {
		if lex == nil {
			continue
		}
		for _, cat := range lex.Categories {
			cat = strings.TrimSpace(cat)
			if cat == "" {
				continue
			}
			if _, ok := seen[cat]; ok {
				continue
			}
			seen[cat] = struct{}{}
			out = append(out, cat)
		}
	}
	return out
}

// toLemmaSnapshotForms deduplicates forms and resolves conflicts:
//   - Spurious LEMMA: if a surface is not the actual lemma and has a specific form type,
//     the LEMMA entry is dropped.
//   - Redundant Unspecified: if a surface has any known form type, the Unspecified entry
//     is dropped (Unspecified means "features not recognized", not useful in snapshot).
func toLemmaSnapshotForms(forms []*entity.LemmaForm, lemmaSurface string) []entity.LemmaSnapshotForm {
	// First pass: track which surfaces have specific (non-LEMMA, non-Unspecified) types,
	// and which have any known (non-Unspecified) type.
	hasSpecificType := make(map[string]bool)
	hasKnownType := make(map[string]bool)
	for _, f := range forms {
		if f == nil {
			continue
		}
		surface := strings.ToLower(strings.TrimSpace(f.Surface))
		if surface == "" {
			continue
		}
		if f.FormType != entity.FormTypeLemma && f.FormType != entity.FormTypeUnspecified {
			hasSpecificType[surface] = true
		}
		if f.FormType != entity.FormTypeUnspecified {
			hasKnownType[surface] = true
		}
	}

	out := make([]entity.LemmaSnapshotForm, 0, len(forms))
	seen := make(map[string]struct{}, len(forms))
	for _, f := range forms {
		if f == nil {
			continue
		}
		surface := strings.TrimSpace(f.Surface)
		if surface == "" {
			continue
		}
		surfaceLower := strings.ToLower(surface)

		// Drop spurious LEMMA: surface is not the lemma and has a specific form type.
		if f.FormType == entity.FormTypeLemma && surfaceLower != lemmaSurface && hasSpecificType[surfaceLower] {
			continue
		}

		// Drop Unspecified: surface already has a known form type.
		if f.FormType == entity.FormTypeUnspecified && hasKnownType[surfaceLower] {
			continue
		}

		key := surface + ":" + string(f.FormType)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, entity.LemmaSnapshotForm{
			Surface:     surface,
			FormType:    string(f.FormType),
			IsIrregular: f.IsIrregular,
			Phonetics:   normalizeFormPhonetics(f.Phonetics),
			Syllables:   f.Syllables,
		})
	}
	return out
}

// findLemmaSyllables derives lemma-level syllables from pctx.Forms.
// It looks for the form whose surface matches the lemma surface (case-insensitive).
func findLemmaSyllables(pctx *pipeline.PipelineContext) []string {
	if pctx == nil || pctx.Lemma == nil {
		return nil
	}
	surface := strings.ToLower(strings.TrimSpace(pctx.Lemma.Surface))
	if surface == "" {
		return nil
	}
	for _, f := range pctx.Forms {
		if f != nil && strings.ToLower(strings.TrimSpace(f.Surface)) == surface && len(f.Syllables) > 0 {
			return append([]string{}, f.Syllables...)
		}
	}
	return nil
}

func normalizeFormPhonetics(phonetics []entity.Phonetic) []entity.Phonetic {
	var out []entity.Phonetic
	seen := map[string]struct{}{}
	for _, ph := range phonetics {
		ipa := strings.TrimSpace(ph.IPA)
		if ipa == "" {
			continue
		}
		key := ipa + "|" + strings.TrimSpace(ph.Dialect)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, entity.Phonetic{
			IPA:     ipa,
			Dialect: strings.TrimSpace(ph.Dialect),
		})
	}
	return out
}

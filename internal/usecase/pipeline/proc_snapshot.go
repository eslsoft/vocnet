package pipeline

import (
	"context"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
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

func (p *LemmaSnapshotProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	// Build snapshot lexemes from context.
	snapshotLexemes := make([]entity.LemmaSnapshotLexeme, 0, len(pctx.Lexemes))
	for _, lex := range pctx.Lexemes {
		senses := make([]entity.LemmaSnapshotSense, 0, len(lex.Senses))
		for _, s := range lex.Senses {
			senses = append(senses, entity.LemmaSnapshotSense{
				Language:    s.Language.Code(),
				Gloss:       s.Gloss,
				Examples:    extractExampleTexts(s.Examples),
				Provider:    "wikidata",
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
			Categories: append([]string{}, lex.Categories...),
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

	snapshotForms := collectSnapshotForms(pctx)

	snapshotData := entity.LemmaSnapshotData{
		Lexemes:     snapshotLexemes,
		Forms:       snapshotForms,
		Frequencies: frequencies,
		Relations:   snapshotRelations,
	}

	quality := p.qualityCalculator.Calculate(snapshotData)
	lexemeCount, senseCount, formCount, relationCount, providerCount := summarizeSnapshotData(snapshotData)

	now := time.Now()
	normalized := ""
	surface := ""
	if pctx.Lemma != nil {
		surface = strings.TrimSpace(pctx.Lemma.Surface)
		normalized = strings.ToLower(surface)
	}

	snapshot := &entity.LemmaSnapshot{
		Surface:       surface,
		Normalized:    normalized,
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

	return &ProcessResult{
		Status:        ProcessStatusExecuted,
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

func collectSnapshotForms(pctx *PipelineContext) []entity.LemmaSnapshotForm {
	if pctx == nil {
		return nil
	}

	var merged []*entity.LemmaForm
	merged = append(merged, pctx.Forms...)
	for _, forms := range pctx.FormsByLexeme {
		merged = append(merged, forms...)
	}
	return toLemmaSnapshotForms(merged)
}

func toLemmaSnapshotForms(forms []*entity.LemmaForm) []entity.LemmaSnapshotForm {
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
		})
	}
	return out
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

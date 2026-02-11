package pipeline

import (
	"context"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
)

// SnapshotProcessor builds the materialized word snapshot and calculates QScore.
// It reads all data from PipelineContext — no DB queries.
type SnapshotProcessor struct {
	qualityCalculator *QualityScoreCalculator
}

// NewSnapshotProcessor creates a new SnapshotProcessor.
func NewSnapshotProcessor() *SnapshotProcessor {
	return &SnapshotProcessor{
		qualityCalculator: NewQualityScoreCalculator(),
	}
}

func (p *SnapshotProcessor) Name() string { return "snapshot" }

func (p *SnapshotProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	// Build snapshot lexemes from context
	snapshotLexemes := make([]entity.SnapshotLexeme, 0, len(pctx.Lexemes))
	for _, lex := range pctx.Lexemes {
		senses := make([]entity.SnapshotSense, 0, len(lex.Senses))
		for _, s := range lex.Senses {
			senses = append(senses, entity.SnapshotSense{
				Language:    s.Language.Code(),
				Gloss:       s.Gloss,
				Examples:    extractExampleTexts(s.Examples),
				Provider:    "wikidata",
				TrustWeight: 0.8,
			})
		}

		lemmaForms := formsForLexeme(pctx, lex.ExternalID)
		snapshotForms := toSnapshotForms(lemmaForms)
		snapshotPhonetics := collectPhonetics(lemmaForms)

		snapshotLexemes = append(snapshotLexemes, entity.SnapshotLexeme{
			POS:       string(lex.PartOfSpeech),
			Senses:    senses,
			Forms:     snapshotForms,
			Phonetics: snapshotPhonetics,
		})
	}

	// Build snapshot relations from context
	snapshotRelations := make([]entity.SnapshotRelation, 0, len(pctx.Relations))
	for _, rel := range pctx.Relations {
		snapshotRelations = append(snapshotRelations, entity.SnapshotRelation{
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

	snapshotData := entity.SnapshotData{
		Lexemes:     snapshotLexemes,
		Frequencies: frequencies,
		Relations:   snapshotRelations,
	}

	// Calculate quality score
	qscore := p.qualityCalculator.Calculate(snapshotData)

	snapshot := &entity.WordSnapshot{
		Term:               pctx.Lemma.Surface,
		Language:           pctx.Language.Code(),
		Version:            1,
		Data:               snapshotData,
		QScore:             qscore.Overall,
		QScoreCompleteness: qscore.Completeness,
		QScoreDepth:        qscore.Depth,
		QScoreDensity:      qscore.Density,
		QScoreValidity:     qscore.Validity,
		SynthesizedAt:      time.Now(),
	}

	return &ProcessResult{
		Status:   ProcessStatusExecuted,
		Snapshot: snapshot,
	}, nil
}

func extractExampleTexts(examples []entity.SenseExample) []string {
	texts := make([]string, 0, len(examples))
	for _, ex := range examples {
		texts = append(texts, ex.Text)
	}
	return texts
}

func formsForLexeme(pctx *PipelineContext, externalID string) []*entity.LemmaForm {
	if pctx == nil {
		return nil
	}
	if externalID != "" && pctx.FormsByLexeme != nil {
		if forms := pctx.FormsByLexeme[externalID]; len(forms) > 0 {
			return forms
		}
	}
	return pctx.Forms
}

func toSnapshotForms(forms []*entity.LemmaForm) []entity.SnapshotForm {
	out := make([]entity.SnapshotForm, 0, len(forms))
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
		out = append(out, entity.SnapshotForm{
			Surface:     surface,
			FormType:    string(f.FormType),
			IsIrregular: f.IsIrregular,
		})
	}
	return out
}

func collectPhonetics(forms []*entity.LemmaForm) []entity.Phonetic {
	var out []entity.Phonetic
	seen := map[string]struct{}{}
	for _, f := range forms {
		if f == nil {
			continue
		}
		for _, ph := range f.Phonetics {
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
	}
	return out
}

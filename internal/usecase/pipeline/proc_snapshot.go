package pipeline

import (
	"context"
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

		snapshotLexemes = append(snapshotLexemes, entity.SnapshotLexeme{
			POS:    lex.PartOfSpeech,
			Senses: senses,
		})
	}

	// Build snapshot relations from context
	snapshotRelations := make([]entity.SnapshotRelation, 0, len(pctx.Relations))
	for _, rel := range pctx.Relations {
		snapshotRelations = append(snapshotRelations, entity.SnapshotRelation{
			RelationType: rel.RelationType,
			TargetTerm:   rel.TargetTerm,
			Provider:     rel.Provider,
			Strength:     rel.Strength,
			SenseMapped:  rel.SenseMapped,
		})
	}

	snapshotData := entity.SnapshotData{
		Lexemes:   snapshotLexemes,
		Relations: snapshotRelations,
	}

	// Calculate quality score
	qscore := p.qualityCalculator.Calculate(snapshotData)

	snapshot := &entity.WordSnapshot{
		Term:               pctx.Lemma.Surface,
		Language:            pctx.Language.Code(),
		WikidataQID:        pctx.Lemma.WikidataQID,
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

package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Phase5Synthesis implements the synthesis phase (materializes snapshot + calculates QScore).
type Phase5Synthesis struct {
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	relationRepo repository.SemanticRelationRepository
	snapshotRepo repository.WordSnapshotRepository
}

func NewPhase5Synthesis(
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	relationRepo repository.SemanticRelationRepository,
	snapshotRepo repository.WordSnapshotRepository,
) *Phase5Synthesis {
	return &Phase5Synthesis{
		lemmaRepo:    lemmaRepo,
		lexemeRepo:   lexemeRepo,
		relationRepo: relationRepo,
		snapshotRepo: snapshotRepo,
	}
}

func (p *Phase5Synthesis) Name() string {
	return entity.PhaseSynthesis.Name()
}

func (p *Phase5Synthesis) Number() int {
	return int(entity.PhaseSynthesis)
}

func (p *Phase5Synthesis) Execute(ctx context.Context, lemma *entity.Lemma) (*PhaseResult, error) {
	// Fetch all lexemes for this lemma
	lexemes, err := p.lexemeRepo.ListByLemmaID(ctx, lemma.ID)
	if err != nil {
		return nil, fmt.Errorf("fetch lexemes: %w", err)
	}

	// Fetch all relations for the lexemes
	var allRelations []*entity.SemanticRelation
	for _, lex := range lexemes {
		relations, err := p.relationRepo.FindBySourceLexeme(ctx, lex.ID)
		if err != nil {
			continue
		}
		allRelations = append(allRelations, relations...)
	}

	// Build snapshot data
	snapshotLexemes := make([]entity.SnapshotLexeme, 0, len(lexemes))
	for _, lex := range lexemes {
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

	snapshotRelations := make([]entity.SnapshotRelation, 0, len(allRelations))
	for _, rel := range allRelations {
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
	qscore := calculateQualityScore(snapshotData)

	// Create or update snapshot
	snapshot := &entity.WordSnapshot{
		LemmaID:            lemma.ID,
		Term:               lemma.Surface,
		Language:           "en", // TODO: get from lemma
		WikidataQID:        lemma.WikidataQID,
		Version:            1,
		Data:               snapshotData,
		QScore:             qscore.Overall,
		QScoreCompleteness: qscore.Completeness,
		QScoreDepth:        qscore.Depth,
		QScoreDensity:      qscore.Density,
		QScoreValidity:     qscore.Validity,
		SynthesizedAt:      time.Now(),
	}

	_, err = p.snapshotRepo.CreateOrUpdate(ctx, snapshot)
	if err != nil {
		return nil, fmt.Errorf("save snapshot: %w", err)
	}

	return &PhaseResult{}, nil
}

// extractExampleTexts extracts text from sense examples.
func extractExampleTexts(examples []entity.SenseExample) []string {
	texts := make([]string, 0, len(examples))
	for _, ex := range examples {
		texts = append(texts, ex.Text)
	}
	return texts
}

// calculateQualityScore computes a multi-dimensional quality score.
func calculateQualityScore(data entity.SnapshotData) entity.QualityScore {
	// Simple scoring heuristics for MVP
	var completeness, depth, density, validity float64

	// Completeness: presence of core fields
	if len(data.Lexemes) > 0 {
		completeness += 30
	}
	if len(data.Relations) > 0 {
		completeness += 20
	}

	// Depth: number of senses
	totalSenses := 0
	for _, lex := range data.Lexemes {
		totalSenses += len(lex.Senses)
	}
	if totalSenses > 0 {
		depth = float64(totalSenses) * 10
		if depth > 50 {
			depth = 50
		}
	}

	// Density: number of relations
	if len(data.Relations) > 0 {
		density = float64(len(data.Relations)) * 5
		if density > 30 {
			density = 30
		}
	}

	// Validity: trust scores (placeholder)
	validity = 20

	overall := (completeness + depth + density + validity) / 4

	return entity.QualityScore{
		Overall:      overall,
		Completeness: completeness,
		Depth:        depth,
		Density:      density,
		Validity:     validity,
	}
}

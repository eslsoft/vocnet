package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wordnet"
	"github.com/eslsoft/vocnet/internal/entity"
)

// ConceptNetProcessor fetches semantic relations from ConceptNet.
type ConceptNetProcessor struct {
	conceptnet provider.ConceptNetProvider
}

// NewConceptNetProcessor creates a new ConceptNetProcessor.
func NewConceptNetProcessor(conceptnet provider.ConceptNetProvider) *ConceptNetProcessor {
	return &ConceptNetProcessor{conceptnet: conceptnet}
}

func (p *ConceptNetProcessor) Name() string { return "conceptnet" }

func (p *ConceptNetProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.conceptnet == nil {
		return &ProcessResult{Status: ProcessStatusSkipped}, nil
	}

	sourceLexemeID := getSourceLexemeID(pctx)
	if sourceLexemeID == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	edges, rawResp, err := p.conceptnet.FetchRelations(ctx, pctx.Term, pctx.Language.Code())
	if err != nil {
		return nil, fmt.Errorf("conceptnet fetch: %w", err)
	}

	evidence := &entity.RawEvidence{
		Provider:      "conceptnet",
		Phase:         int32(entity.PhaseRelational),
		Content:       rawResp,
		SchemaVersion: "conceptnet-5.7",
		FetchedAt:     time.Now(),
	}

	relations := make([]*entity.SemanticRelation, 0, len(edges))
	for _, edge := range edges {
		targetTerm := edge.EndTerm
		if edge.EndTerm == pctx.Term {
			targetTerm = edge.StartTerm
		}

		relations = append(relations, &entity.SemanticRelation{
			SourceLexemeID: sourceLexemeID,
			TargetLexemeID: nil,
			TargetTerm:     targetTerm,
			RelationType:   edge.RelationType,
			Provider:       "conceptnet",
			Strength:       edge.Weight,
			SenseMapped:    false,
		})
	}

	return &ProcessResult{
		Status:    ProcessStatusExecuted,
		Evidence:  []*entity.RawEvidence{evidence},
		Relations: relations,
	}, nil
}

// WordNetProcessor fetches hypernym paths and relations from WordNet.
type WordNetProcessor struct {
	reader *wordnet.Reader
}

// NewWordNetProcessor creates a new WordNetProcessor.
func NewWordNetProcessor(reader *wordnet.Reader) *WordNetProcessor {
	return &WordNetProcessor{reader: reader}
}

func (p *WordNetProcessor) Name() string { return "wordnet" }

func (p *WordNetProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.reader == nil {
		return &ProcessResult{Status: ProcessStatusSkipped}, nil
	}

	sourceLexemeID := getSourceLexemeID(pctx)
	if sourceLexemeID == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	synsets, err := p.reader.LookupSynsets(ctx, pctx.Term, "noun")
	if err != nil || len(synsets) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	primarySynset := synsets[0]

	// Create evidence
	evidence := &entity.RawEvidence{
		Provider: "wordnet",
		Phase:    int32(entity.PhaseRelational),
		Content: map[string]any{
			"word":      pctx.Term,
			"synsets":   1,
			"offset":    primarySynset.Offset,
			"pos":       primarySynset.POS,
			"words":     primarySynset.Words,
			"gloss":     primarySynset.Gloss,
			"relations": len(primarySynset.Relations),
		},
		SchemaVersion: "wordnet-3.1",
		FetchedAt:     time.Now(),
	}

	var relations []*entity.SemanticRelation

	// Extract hypernym path
	hypernymPath, err := p.reader.GetHypernymPath(ctx, primarySynset)
	if err == nil && len(hypernymPath) > 1 {
		for i := 0; i < len(hypernymPath)-1; i++ {
			parentSynset := hypernymPath[i+1]
			relations = append(relations, &entity.SemanticRelation{
				SourceLexemeID: sourceLexemeID,
				TargetLexemeID: nil,
				TargetTerm:     fmt.Sprintf("synset:%s (%s)", parentSynset.Offset, parentSynset.Words[0]),
				RelationType:   entity.RelationHypernym,
				Provider:       "wordnet",
				Strength:       1.0,
				SenseMapped:    true,
			})
		}
	}

	// Extract other relations (skip hypernyms, already extracted above)
	for _, rel := range primarySynset.Relations {
		if rel.Symbol == "@" {
			continue
		}

		relType := wordnet.MapWordNetRelation(rel.Symbol)
		if relType == "" {
			continue
		}

		relations = append(relations, &entity.SemanticRelation{
			SourceLexemeID: sourceLexemeID,
			TargetLexemeID: nil,
			TargetTerm:     fmt.Sprintf("synset:%s", rel.TargetID),
			RelationType:   relType,
			Provider:       "wordnet",
			Strength:       1.0,
			SenseMapped:    true,
		})
	}

	return &ProcessResult{
		Status:    ProcessStatusExecuted,
		Evidence:  []*entity.RawEvidence{evidence},
		Relations: relations,
	}, nil
}

// getSourceLexemeID returns the primary lexeme ID from the pipeline context.
// Shared by ConceptNetProcessor and WordNetProcessor.
func getSourceLexemeID(pctx *PipelineContext) int64 {
	if len(pctx.Lexemes) == 0 {
		return 0
	}
	return pctx.Lexemes[0].ID
}

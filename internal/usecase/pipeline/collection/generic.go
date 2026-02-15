package collection

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
)

// GenericSourceProcessor wraps any SourceProvider as a pipeline Processor.
// It sends only term+language to the source, then converts the raw
// SourceResult back into a ProcessResult for the pipeline.
type GenericSourceProcessor struct {
	source   repository.SourceProvider
	provider string // cached provider name from manifest
}

// NewGenericSourceProcessor creates a generic processor from a SourceProvider.
func NewGenericSourceProcessor(source repository.SourceProvider, logger *slog.Logger) *GenericSourceProcessor {
	providerName := ""
	if source != nil {
		providerName = source.Manifest().Name
	}
	return &GenericSourceProcessor{
		source:   source,
		provider: providerName,
	}
}

func (p *GenericSourceProcessor) Name() string {
	return p.provider
}

func (p *GenericSourceProcessor) Process(ctx context.Context, pctx *pipeline.PipelineContext) (*scoring.ProcessResult, error) {
	if p.source == nil {
		return nil, &pipeline.ErrProcessorSkipped{Reason: p.Name() + " not available"}
	}

	query := repository.SourceQuery{
		Term:     pctx.Term,
		Language: pctx.Language.Code(),
	}

	result, err := p.source.Lookup(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("%s lookup: %w", p.Name(), err)
	}
	if result == nil {
		return &scoring.ProcessResult{Status: scoring.ProcessStatusNoData}, nil
	}

	// Ensure provider is set on all fragments
	for _, lex := range result.Lexemes {
		for i := range lex.Senses {
			lex.Senses[i].Provider = p.provider
		}
	}
	for _, f := range result.Forms {
		for i := range f.Phonetics {
			f.Phonetics[i].Provider = p.provider
		}
	}

	pr := sourceResultToProcessResult(result)
	// Attach provider name to ProcessResult for evaluator
	pr.Provider = p.provider

	// For contrib sources that return relations but no lexemes,
	// try to map relations to existing lexemes in the pipeline context
	if len(pr.Relations) > 0 && len(pr.Lexemes) == 0 && len(pctx.Lexemes) > 0 {
		p.mapRelationsToContextLexemes(pr.Relations, pctx.Lexemes)
	}

	return pr, nil
}

func sourceResultToProcessResult(sr *repository.SourceResult) *scoring.ProcessResult {
	pr := &scoring.ProcessResult{
		Status:        scoring.ProcessStatusExecuted,
		Evidence:      sr.Evidence,
		Lexemes:       sr.Lexemes,
		Relations:     sr.Relations,
		Forms:         sr.Forms,
		FormsByLexeme: sr.FormsByLexeme,
		LemmaUpdate:   sr.LemmaUpdate,
	}

	// If no data was produced, mark as NoData
	if len(sr.Evidence) == 0 && len(sr.Lexemes) == 0 && len(sr.Relations) == 0 &&
		len(sr.Forms) == 0 && len(sr.FormsByLexeme) == 0 && sr.LemmaUpdate == nil {
		pr.Status = scoring.ProcessStatusNoData
	}

	// Fix contrib source relations: map relations to lexemes returned by the same source
	// This handles the case where contrib sources return relations without SourceExternalID
	if len(sr.Relations) > 0 && len(sr.Lexemes) > 0 {
		// Create a map of lexemes by their external ID
		lexemeByExtID := make(map[string]*entity.Lexeme)
		for _, lex := range sr.Lexemes {
			if lex.ExternalID != "" {
				lexemeByExtID[lex.ExternalID] = lex
			}
		}

		// Try to map relations to lexemes if SourceExternalID is missing
		for _, rel := range sr.Relations {
			if rel.SourceExternalID == "" && len(lexemeByExtID) > 0 {
				// For contrib sources, if no specific source is specified,
				// associate with the first lexeme from the same lookup
				// This is a reasonable default for most contrib sources
				for extID := range lexemeByExtID {
					rel.SourceExternalID = extID
					break // Use first available lexeme
				}
			}
		}
	}

	return pr
}

// mapRelationsToContextLexemes maps relations to existing lexemes in the pipeline context
// using POS matching and gloss similarity for disambiguation.
// This is used for contrib sources like WordNet that provide relations but not lexemes.
func (p *GenericSourceProcessor) mapRelationsToContextLexemes(relations []*entity.SemanticRelation, contextLexemes []*entity.Lexeme) {
	if len(relations) == 0 || len(contextLexemes) == 0 {
		return
	}

	// Build POS index: POS → []*entity.Lexeme
	lexemesByPOS := make(map[entity.PartOfSpeech][]*entity.Lexeme)
	for _, lex := range contextLexemes {
		lexemesByPOS[lex.PartOfSpeech] = append(lexemesByPOS[lex.PartOfSpeech], lex)
	}

	for _, rel := range relations {
		if rel.SourceExternalID != "" {
			continue
		}

		target := matchRelationToLexeme(rel, contextLexemes, lexemesByPOS)
		if target == nil {
			continue
		}

		rel.SourceExternalID = target.ExternalID
	}
}

// matchRelationToLexeme finds the best matching lexeme for a relation using POS and gloss.
func matchRelationToLexeme(rel *entity.SemanticRelation, allLexemes []*entity.Lexeme, lexemesByPOS map[entity.PartOfSpeech][]*entity.Lexeme) *entity.Lexeme {
	// If no POS hint, fall back to first lexeme
	if rel.SourcePOS == "" {
		return allLexemes[0]
	}

	pos := entity.PartOfSpeech(rel.SourcePOS)
	candidates := lexemesByPOS[pos]
	if len(candidates) == 0 {
		// No lexeme with matching POS — skip
		return nil
	}
	if len(candidates) == 1 {
		return candidates[0]
	}

	// Multiple candidates with same POS (homonyms) — use gloss similarity
	if rel.SourceGloss == "" {
		return candidates[0]
	}

	bestLex := candidates[0]
	bestScore := float64(-1)
	for _, lex := range candidates {
		score := lexemeGlossSimilarity(rel.SourceGloss, lex)
		if score > bestScore {
			bestScore = score
			bestLex = lex
		}
	}
	return bestLex
}

// lexemeGlossSimilarity computes the best Jaccard similarity between a source gloss
// and any gloss associated with the lexeme (SenseGloss or individual Senses).
func lexemeGlossSimilarity(sourceGloss string, lex *entity.Lexeme) float64 {
	best := glossJaccard(sourceGloss, lex.SenseGloss)
	for _, s := range lex.Senses {
		if score := glossJaccard(sourceGloss, s.Gloss); score > best {
			best = score
		}
	}
	return best
}

// glossJaccard computes Jaccard similarity on lowercased word tokens.
func glossJaccard(a, b string) float64 {
	tokA := tokenizeGloss(a)
	tokB := tokenizeGloss(b)
	if len(tokA) == 0 || len(tokB) == 0 {
		return 0
	}

	setA := make(map[string]struct{}, len(tokA))
	for _, t := range tokA {
		setA[t] = struct{}{}
	}
	setB := make(map[string]struct{}, len(tokB))
	for _, t := range tokB {
		setB[t] = struct{}{}
	}

	inter := 0
	for t := range setA {
		if _, ok := setB[t]; ok {
			inter++
		}
	}

	union := len(setA)
	for t := range setB {
		if _, ok := setA[t]; !ok {
			union++
		}
	}
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

// tokenizeGloss splits a gloss string into lowercase word tokens.
func tokenizeGloss(s string) []string {
	return strings.Fields(strings.ToLower(s))
}

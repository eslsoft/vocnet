package collection

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
)

// wikidataFormLookup is an optional interface for lexeme-by-form lookup.
type wikidataFormLookup interface {
	FetchLexemesByForm(ctx context.Context, form string, language string) ([]provider.WikidataLexeme, error)
}

// WikidataProcessor fetches lexemes, forms, and relations from Wikidata.
type WikidataProcessor struct {
	wikidata provider.WikidataProvider
	logger   *slog.Logger
}

// NewWikidataProcessor creates a new WikidataProcessor.
func NewWikidataProcessor(wikidata provider.WikidataProvider, logger *slog.Logger) *WikidataProcessor {
	return &WikidataProcessor{wikidata: wikidata, logger: logger}
}

func (p *WikidataProcessor) Name() string { return "wikidata" }

func (p *WikidataProcessor) Process(ctx context.Context, pctx *pipeline.PipelineContext) (*scoring.ProcessResult, error) {
	if p.wikidata == nil {
		return nil, &pipeline.ErrProcessorSkipped{Reason: "wikidata not available"}
	}

	term := pctx.Term
	lang := pctx.Language

	// Phase 1: Fetch lexemes
	lexemes, rawResp, err := p.wikidata.FetchLexemes(ctx, term, lang.Code())
	if err != nil {
		return nil, fmt.Errorf("fetch lexemes: %w", err)
	}
	if rejectLowConfidenceLexemeMatch(rawResp) {
		return nil, fmt.Errorf("low-confidence lexeme match rejected for: %s", term)
	}
	if len(lexemes) == 0 {
		return nil, fmt.Errorf("word not found in Wikidata: %s (non-standard vocabulary rejected)", term)
	}

	// Create evidence
	evidence := &entity.RawEvidence{
		Provider:      "wikidata",
		Phase:         string(pipeline.PhaseCollection),
		Content:       rawResp,
		SchemaVersion: "wikidata-2025",
		FetchedAt:     time.Now(),
	}

	// Convert provider lexemes to entity lexemes
	entityLexemes := make([]*entity.Lexeme, 0, len(lexemes))
	allForms := make([]*entity.LemmaForm, 0)
	formsByLexeme := make(map[string][]*entity.LemmaForm)

	for _, lex := range lexemes {
		entityLex, lexemeForms, err := convertProviderLexeme(lex, term, lang)
		if err != nil {
			return nil, fmt.Errorf("wikidata lexeme %s %w", lex.LexemeID, err)
		}

		// Log form details
		for _, f := range lexemeForms {
			p.logger.Debug("wikidata form",
				"surface", f.Surface,
				"formType", f.FormType,
				"phonetics", len(f.Phonetics),
				"irregular", f.IsIrregular,
				"lexeme", lex.LexemeID)
		}

		// Infer categories from senses
		entityLex.Categories = inferCategoriesFromSenses(entityLex.Senses)

		formsByLexeme[lex.LexemeID] = lexemeForms
		allForms = append(allForms, lexemeForms...)
		entityLexemes = append(entityLexemes, entityLex)
	}

	// Preserve the requested spelling variant at lemma level.
	allForms = ensureSurfaceForm(allForms, term)

	// Phase 2: Build relations
	relations := p.buildRelations(ctx, pctx, entityLexemes)

	p.logger.Info("wikidata processor completed",
		"term", term,
		"lexemes", len(entityLexemes),
		"forms", len(allForms),
		"relations", len(relations))

	return &scoring.ProcessResult{
		Status:        scoring.ProcessStatusExecuted,
		Evidence:      []*entity.RawEvidence{evidence},
		Lexemes:       entityLexemes,
		Forms:         allForms,
		FormsByLexeme: formsByLexeme,
		Relations:     relations,
	}, nil
}

// buildRelations discovers relations between lexemes via form lookup.
func (p *WikidataProcessor) buildRelations(ctx context.Context, pctx *pipeline.PipelineContext, lexemes []*entity.Lexeme) []*entity.SemanticRelation {
	lookup, ok := p.wikidata.(wikidataFormLookup)
	if !ok {
		return nil
	}

	if len(lexemes) == 0 {
		return nil
	}

	sourceExtID := lexemes[0].ExternalID
	if sourceExtID == "" {
		return nil
	}

	// Build known lexeme ID set
	knownLexemeIDs := make(map[string]struct{}, len(lexemes))
	for _, lex := range lexemes {
		if lex == nil || strings.TrimSpace(lex.ExternalID) == "" {
			continue
		}
		knownLexemeIDs[strings.TrimSpace(lex.ExternalID)] = struct{}{}
	}

	// Update pctx with newly discovered lexemes and forms before building lookup terms
	tempCtx := &pipeline.PipelineContext{
		Term:     pctx.Term,
		Language: pctx.Language,
		Lexemes:  lexemes,
		Forms:    pctx.Forms,
	}

	lookupTerms := buildRelationLookupTerms(tempCtx)
	relations := make([]*entity.SemanticRelation, 0, 32)
	seen := make(map[string]struct{})

	// Link same-term sibling lexemes (polysemy anchors)
	for _, lex := range lexemes {
		if lex == nil || strings.TrimSpace(lex.ExternalID) == "" || lex.ExternalID == sourceExtID {
			continue
		}
		relations = addRelation(relations, seen, sourceExtID, lex.ExternalID, pctx.Term)
	}

	// Query for related lexemes by form
	for _, term := range lookupTerms {
		candidates, err := lookup.FetchLexemesByForm(ctx, term, pctx.Language.Code())
		if err != nil {
			continue
		}
		for _, cand := range candidates {
			targetID := strings.TrimSpace(cand.LexemeID)
			if targetID == "" || targetID == sourceExtID {
				continue
			}
			if _, ok := knownLexemeIDs[targetID]; !ok {
				// Keep only lexemes already validated in the current context
				continue
			}
			targetTerm := pickRelationTerm(cand, term)
			relations = addRelation(relations, seen, sourceExtID, targetID, targetTerm)
		}
	}

	return relations
}

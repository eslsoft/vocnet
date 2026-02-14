package pipeline

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
)

// WikidataRelationProcessor builds wikidata://lexeme/* relations from lexical neighborhood.
type WikidataRelationProcessor struct {
	wikidata provider.WikidataProvider
}

type wikidataFormLookup interface {
	FetchLexemesByForm(ctx context.Context, form string, language string) ([]provider.WikidataLexeme, error)
}

func NewWikidataRelationProcessor(wikidata provider.WikidataProvider) *WikidataRelationProcessor {
	return &WikidataRelationProcessor{wikidata: wikidata}
}

func (p *WikidataRelationProcessor) Name() string { return "wikidata_relations" }

func (p *WikidataRelationProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.wikidata == nil {
		return nil, &ErrProcessorSkipped{Reason: "wikidata not available"}
	}
	lookup, ok := p.wikidata.(wikidataFormLookup)
	if !ok {
		return nil, &ErrProcessorSkipped{Reason: "wikidata form lookup not supported"}
	}

	sourceExtID := getPrimaryExternalID(pctx)
	if sourceExtID == "" {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	knownLexemeIDs := make(map[string]struct{}, len(pctx.Lexemes))
	for _, lex := range pctx.Lexemes {
		if lex == nil || strings.TrimSpace(lex.ExternalID) == "" {
			continue
		}
		knownLexemeIDs[strings.TrimSpace(lex.ExternalID)] = struct{}{}
	}

	lookupTerms := wikidataRelationLookupTerms(pctx)
	relations := make([]*entity.SemanticRelation, 0, 32)
	seen := make(map[string]struct{})

	// Link same-term sibling lexemes discovered in phase 1 (polysemy anchors).
	for _, lex := range pctx.Lexemes {
		if lex == nil || strings.TrimSpace(lex.ExternalID) == "" || lex.ExternalID == sourceExtID {
			continue
		}
		relations = addWikidataRelation(relations, seen, sourceExtID, lex.ExternalID, pctx.Term)
	}

	queried := 0
	for _, term := range lookupTerms {
		queried++
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
				// Keep only lexemes already validated in the current context to avoid noisy expansion.
				continue
			}
			targetTerm := pickWikidataRelationTerm(cand, term)
			relations = addWikidataRelation(relations, seen, sourceExtID, targetID, targetTerm)
		}
	}

	if len(relations) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	evidence := &entity.RawEvidence{
		Provider: "wikidata",
		Phase:    int32(entity.PhaseRelational),
		Content: map[string]any{
			"source":               "wikidata-lexeme-neighborhood",
			"term":                 pctx.Term,
			"language":             pctx.Language.Code(),
			"lookup_terms":         lookupTerms,
			"lookup_terms_queried": queried,
			"relations_found":      len(relations),
		},
		SchemaVersion: "wikidata-relations-v1",
		FetchedAt:     time.Now(),
	}

	return &ProcessResult{
		Status:    ProcessStatusExecuted,
		Evidence:  []*entity.RawEvidence{evidence},
		Relations: relations,
	}, nil
}

func wikidataRelationLookupTerms(pctx *PipelineContext) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, 8)
	add := func(s string) {
		v := strings.TrimSpace(s)
		if v == "" {
			return
		}
		key := strings.ToLower(v)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, v)
	}

	add(pctx.Term)
	for _, f := range pctx.Forms {
		if f == nil {
			continue
		}
		add(f.Surface)
	}
	sort.SliceStable(out, func(i, j int) bool { return len(out[i]) < len(out[j]) })
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func addWikidataRelation(
	relations []*entity.SemanticRelation,
	seen map[string]struct{},
	sourceExternalID string,
	targetExternalID string,
	targetTerm string,
) []*entity.SemanticRelation {
	targetRef := wikidataLexemeRef(targetExternalID)
	if targetRef == "" {
		return relations
	}
	key := entity.RelationAssociation + "|" + strings.ToLower(targetRef)
	if _, ok := seen[key]; ok {
		return relations
	}
	seen[key] = struct{}{}
	term := strings.TrimSpace(targetTerm)
	if term == "" {
		term = targetExternalID
	}
	return append(relations, &entity.SemanticRelation{
		SourceExternalID: sourceExternalID,
		TargetRef:        targetRef,
		TargetTerm:       term,
		RelationType:     entity.RelationAssociation,
		Provider:         "wikidata",
		Strength:         0.9,
		SenseMapped:      false, // association by lexeme neighborhood, not actual sense mapping
	})
}

func pickWikidataRelationTerm(lex provider.WikidataLexeme, fallback string) string {
	best := strings.TrimSpace(fallback)
	for _, f := range lex.Forms {
		surface := strings.TrimSpace(f.Representation)
		if surface == "" {
			continue
		}
		if best == "" || len(surface) < len(best) {
			best = surface
		}
	}
	if best == "" {
		best = lex.LexemeID
	}
	return best
}

// getPrimaryExternalID returns the Wikidata ExternalID of the primary lexeme.
func getPrimaryExternalID(pctx *PipelineContext) string {
	if len(pctx.Lexemes) == 0 {
		return ""
	}
	return pctx.Lexemes[0].ExternalID
}

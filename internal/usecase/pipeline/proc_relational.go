package pipeline

import (
	"context"
	"fmt"
	"sort"
	"strings"
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
		return nil, &ErrProcessorSkipped{Reason: "conceptnet not available"}
	}

	sourceExtID := getPrimaryExternalID(pctx)
	if sourceExtID == "" {
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
		if edge.Weight <= 1.0 {
			// Design rule: prune low-signal ConceptNet edges.
			continue
		}
		targetTerm := edge.EndTerm
		if edge.EndTerm == pctx.Term {
			targetTerm = edge.StartTerm
		}

		relations = append(relations, &entity.SemanticRelation{
			SourceExternalID: sourceExtID,
			TargetRef:        conceptNetTermRef(pctx.Language.Code(), targetTerm),
			TargetTerm:       targetTerm,
			RelationType:     edge.RelationType,
			Provider:         "conceptnet",
			Strength:         normalizeConceptNetWeight(edge.Weight),
			SenseMapped:      false,
		})
	}

	return &ProcessResult{
		Status:    ProcessStatusExecuted,
		Evidence:  []*entity.RawEvidence{evidence},
		Relations: relations,
	}, nil
}

func normalizeConceptNetWeight(weight float64) float64 {
	if weight <= 0 {
		return 0
	}
	// ConceptNet weights are open-ended; convert to [0,1) while preserving ranking.
	return clamp01(weight / (weight + 1.0))
}

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
		return nil, &ErrProcessorSkipped{Reason: "wordnet not available"}
	}

	sourceExtID := getPrimaryExternalID(pctx)
	if sourceExtID == "" {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	posCandidates := wordNetPOSCandidates(pctx.Lexemes)
	collected := p.collectPrimarySynsets(ctx, pctx.Term, posCandidates)

	if len(collected) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	// Create evidence
	evidence := &entity.RawEvidence{
		Provider: "wordnet",
		Phase:    int32(entity.PhaseRelational),
		Content: map[string]any{
			"word":           pctx.Term,
			"pos_candidates": posCandidates,
			"synsets":        wordNetEvidenceSynsets(collected),
		},
		SchemaVersion: "wordnet-3.1",
		FetchedAt:     time.Now(),
	}

	relations := p.extractWordNetRelations(ctx, sourceExtID, collected)

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
		SenseMapped:      true,
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

func (p *WordNetProcessor) collectPrimarySynsets(ctx context.Context, term string, posCandidates []string) []*wordnet.Synset {
	collected := make([]*wordnet.Synset, 0, len(posCandidates))
	seen := make(map[string]struct{})
	for _, pos := range posCandidates {
		synsets, err := p.reader.LookupSynsets(ctx, term, pos)
		if err != nil || len(synsets) == 0 {
			continue
		}
		primary := synsets[0]
		key := primary.POS + ":" + primary.Offset
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		collected = append(collected, primary)
	}
	return collected
}

func wordNetEvidenceSynsets(collected []*wordnet.Synset) []map[string]any {
	evidenceSynsets := make([]map[string]any, 0, len(collected))
	for _, syn := range collected {
		evidenceSynsets = append(evidenceSynsets, map[string]any{
			"offset":    syn.Offset,
			"pos":       syn.POS,
			"words":     syn.Words,
			"gloss":     syn.Gloss,
			"relations": len(syn.Relations),
		})
	}
	return evidenceSynsets
}

func (p *WordNetProcessor) extractWordNetRelations(ctx context.Context, sourceExtID string, synsets []*wordnet.Synset) []*entity.SemanticRelation {
	relations := make([]*entity.SemanticRelation, 0, 64)
	relationSeen := make(map[string]struct{})
	for _, syn := range synsets {
		relations = p.appendWordNetHypernyms(ctx, sourceExtID, syn, relations, relationSeen)
		relations = p.appendWordNetOtherRelations(sourceExtID, syn, relations, relationSeen)
	}
	return relations
}

func (p *WordNetProcessor) appendWordNetHypernyms(
	ctx context.Context,
	sourceExtID string,
	syn *wordnet.Synset,
	relations []*entity.SemanticRelation,
	relationSeen map[string]struct{},
) []*entity.SemanticRelation {
	hypernymPath, err := p.reader.GetHypernymPath(ctx, syn)
	if err != nil || len(hypernymPath) <= 1 {
		return relations
	}
	for i := 0; i < len(hypernymPath)-1; i++ {
		parentSynset := hypernymPath[i+1]
		targetWord := parentSynset.Offset
		if len(parentSynset.Words) > 0 {
			targetWord = parentSynset.Words[0]
		}
		rel := &entity.SemanticRelation{
			SourceExternalID: sourceExtID,
			TargetRef:        wordnetSynsetRef(parentSynset.Offset),
			TargetTerm:       fmt.Sprintf("synset:%s (%s)", parentSynset.Offset, targetWord),
			RelationType:     entity.RelationHypernym,
			Provider:         "wordnet",
			Strength:         1.0,
			SenseMapped:      true,
		}
		relations = appendUniqueRelation(relations, relationSeen, rel)
	}
	return relations
}

func (p *WordNetProcessor) appendWordNetOtherRelations(
	sourceExtID string,
	syn *wordnet.Synset,
	relations []*entity.SemanticRelation,
	relationSeen map[string]struct{},
) []*entity.SemanticRelation {
	for _, rel := range syn.Relations {
		if rel.Symbol == "@" {
			continue
		}
		relType := wordnet.MapWordNetRelation(rel.Symbol)
		if relType == "" {
			continue
		}
		item := &entity.SemanticRelation{
			SourceExternalID: sourceExtID,
			TargetRef:        wordnetSynsetRef(rel.TargetID),
			TargetTerm:       fmt.Sprintf("synset:%s", rel.TargetID),
			RelationType:     relType,
			Provider:         "wordnet",
			Strength:         1.0,
			SenseMapped:      true,
		}
		relations = appendUniqueRelation(relations, relationSeen, item)
	}
	return relations
}

func appendUniqueRelation(
	relations []*entity.SemanticRelation,
	relationSeen map[string]struct{},
	rel *entity.SemanticRelation,
) []*entity.SemanticRelation {
	if rel == nil {
		return relations
	}
	key := rel.RelationType + "|" + strings.ToLower(strings.TrimSpace(rel.TargetRef)) + "|" + strings.ToLower(strings.TrimSpace(rel.TargetTerm))
	if _, ok := relationSeen[key]; ok {
		return relations
	}
	relationSeen[key] = struct{}{}
	return append(relations, rel)
}

func wordNetPOSCandidates(lexemes []*entity.Lexeme) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, 4)
	add := func(pos string) {
		if pos == "" {
			return
		}
		if _, ok := seen[pos]; ok {
			return
		}
		seen[pos] = struct{}{}
		out = append(out, pos)
	}

	for _, lex := range lexemes {
		if lex == nil {
			continue
		}
		switch lex.PartOfSpeech {
		case entity.PartOfSpeechNoun, entity.PartOfSpeechProperNoun, entity.PartOfSpeechPronoun, entity.PartOfSpeechDeterminer, entity.PartOfSpeechNumeral:
			add("noun")
		case entity.PartOfSpeechVerb:
			add("verb")
		case entity.PartOfSpeechAdjective:
			add("adjective")
		case entity.PartOfSpeechAdverb:
			add("adverb")
		}
	}

	// Fallback for sparse/unknown POS.
	add("noun")
	add("verb")
	add("adjective")
	add("adverb")
	return out
}

// getPrimaryExternalID returns the Wikidata ExternalID of the primary lexeme.
func getPrimaryExternalID(pctx *PipelineContext) string {
	if len(pctx.Lexemes) == 0 {
		return ""
	}
	return pctx.Lexemes[0].ExternalID
}

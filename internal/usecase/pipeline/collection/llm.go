package collection

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
)

// LLMEnrichmentProcessor uses LLM to fill gaps in collected data.
// It runs after Collection phase and before Evaluation phase.
// LLM-generated data is added as Evidence and will be scored by FragmentEvaluator.
type LLMEnrichmentProcessor struct {
	llm    llm.Provider
	logger *slog.Logger
}

func NewLLMEnrichmentProcessor(provider llm.Provider, logger *slog.Logger) *LLMEnrichmentProcessor {
	return &LLMEnrichmentProcessor{llm: provider, logger: logger}
}

func (p *LLMEnrichmentProcessor) Name() string { return "llm_enrichment" }

func (p *LLMEnrichmentProcessor) Process(ctx context.Context, pctx *pipeline.PipelineContext) (*scoring.ProcessResult, error) {
	if p.llm == nil {
		return nil, &pipeline.ErrProcessorSkipped{Reason: "llm not configured"}
	}

	// Analyze what's missing or incomplete
	gaps := p.analyzeDataGaps(pctx)
	if gaps.isEmpty() {
		p.logger.Info("llm_enrichment: no gaps detected, skipping")
		return &scoring.ProcessResult{Status: scoring.ProcessStatusNoData}, nil
	}

	p.logger.Info("llm_enrichment: detected gaps",
		"incomplete_lexemes", len(gaps.IncompleteLexemes),
		"needs_sense_mapping", len(gaps.UnmappedRelations),
		"needs_relation_scoring", len(gaps.UnscoredRelations),
	)

	// Build unified prompt for all enrichment tasks
	userPrompt := p.buildEnrichmentPrompt(pctx, gaps)

	resp, err := p.llm.Complete(ctx, &llm.CompletionRequest{
		SystemPrompt: `You are a lexicographic data enrichment assistant.
Your tasks:
1. Fill missing lexeme senses, glosses, and examples
2. Map semantic relations to specific lexeme senses
3. Score relation strengths (0.0-1.0)

Always respond with valid JSON only.`,
		UserPrompt: userPrompt,
		JSONMode:   true,
	})
	if err != nil {
		return nil, fmt.Errorf("llm complete: %w", err)
	}

	var result llmEnrichmentResponse
	if err := json.Unmarshal([]byte(resp.Content), &result); err != nil {
		return nil, fmt.Errorf("parse llm enrichment response: %w", err)
	}

	// Convert LLM response to Evidence for later evaluation
	evidence := p.convertToEvidence(&result, resp, pctx.Term)

	p.logger.Info("llm_enrichment: completed",
		"enriched_lexemes", len(result.Lexemes),
		"mapped_relations", len(result.MappedRelations),
		"scored_relations", len(result.ScoredRelations),
		"cached", resp.Cached,
		"tokens", resp.TokenCount,
	)

	// Accumulate LLM data into context with provider="llm"
	// It will compete with other sources in Evaluation phase
	p.accumulateLLMData(pctx, &result)

	return &scoring.ProcessResult{
		Status:   scoring.ProcessStatusExecuted,
		Evidence: evidence,
	}, nil
}

type dataGaps struct {
	IncompleteLexemes []*entity.Lexeme           // Lexemes missing senses/gloss/examples
	UnmappedRelations []relationGap              // Relations with SenseMapped=false
	UnscoredRelations []relationGap              // Relations without quality scores
}

type relationGap struct {
	Index    int // Global index in pctx.Relations
	Relation *entity.SemanticRelation
}

func (g *dataGaps) isEmpty() bool {
	return len(g.IncompleteLexemes) == 0 &&
		len(g.UnmappedRelations) == 0 &&
		len(g.UnscoredRelations) == 0
}

func (p *LLMEnrichmentProcessor) analyzeDataGaps(pctx *pipeline.PipelineContext) *dataGaps {
	gaps := &dataGaps{}

	// Check lexeme completeness
	for _, lex := range pctx.Lexemes {
		if p.needsEnrichment(lex) {
			gaps.IncompleteLexemes = append(gaps.IncompleteLexemes, lex)
		}
	}

	// Check relation mapping and scoring
	for i, rel := range pctx.Relations {
		needsMapping := !rel.SenseMapped
		needsScoring := rel.Strength == 0 || rel.Provider == "conceptnet"

		if needsMapping {
			gaps.UnmappedRelations = append(gaps.UnmappedRelations, relationGap{Index: i, Relation: rel})
		}
		if needsScoring {
			gaps.UnscoredRelations = append(gaps.UnscoredRelations, relationGap{Index: i, Relation: rel})
		}
	}

	return gaps
}

func (p *LLMEnrichmentProcessor) needsEnrichment(lex *entity.Lexeme) bool {
	// Missing sense gloss
	if lex.SenseGloss == "" {
		return true
	}

	// Check if we have both English and Chinese senses
	hasEN, hasZH := false, false
	for _, s := range lex.Senses {
		switch s.Language {
		case entity.LanguageEnglish:
			hasEN = true
		case entity.LanguageChinese:
			hasZH = true
		}
	}
	if !hasEN || !hasZH {
		return true
	}

	// Check if senses have examples
	for _, s := range lex.Senses {
		if len(s.Examples) < 1 {
			return true
		}
	}

	return false
}

func (p *LLMEnrichmentProcessor) buildEnrichmentPrompt(pctx *pipeline.PipelineContext, gaps *dataGaps) string {
	type lexemeData struct {
		LexemeID   string               `json:"lexeme_id"`
		POS        string               `json:"pos"`
		SenseGloss string               `json:"sense_gloss,omitempty"`
		Senses     []entity.LexemeSense `json:"senses,omitempty"`
	}

	type relationData struct {
		RelationID   string `json:"relation_id"` // Global index
		RelationType string `json:"relation_type"`
		TargetTerm   string `json:"target_term"`
		Provider     string `json:"provider"`
		Strength     string `json:"current_strength,omitempty"`
	}

	prompt := fmt.Sprintf(`Enrich vocabulary data for the word "%s".\n\n`, pctx.Term)

	// Task 1: Lexeme enrichment
	if len(gaps.IncompleteLexemes) > 0 {
		lexemes := make([]lexemeData, 0, len(gaps.IncompleteLexemes))
		for _, lex := range gaps.IncompleteLexemes {
			lexemes = append(lexemes, lexemeData{
				LexemeID:   lex.ExternalID,
				POS:        string(lex.PartOfSpeech),
				SenseGloss: lex.SenseGloss,
				Senses:     lex.Senses,
			})
		}
		lexemesJSON, _ := json.MarshalIndent(lexemes, "", "  ")
		prompt += fmt.Sprintf(`Task 1: Fill missing lexeme data
Current lexemes:
%s

Instructions:
- Fill missing sense_gloss (concise English, max 10 words)
- Add missing English ("en") and Chinese ("zh") senses
- Each sense should have at least 2 example sentences
- English examples: simple English sentences
- Chinese examples: English sentences with Chinese translations
- Do NOT remove existing senses

`, lexemesJSON)
	}

	// Task 2: Sense mapping
	if len(gaps.UnmappedRelations) > 0 {
		lexemeSummary := make([]map[string]any, 0, len(pctx.Lexemes))
		for _, lex := range pctx.Lexemes {
			lexemeSummary = append(lexemeSummary, map[string]any{
				"external_id":  lex.ExternalID,
				"pos":          string(lex.PartOfSpeech),
				"sense_gloss":  lex.SenseGloss,
				"sense_count":  len(lex.Senses),
			})
		}
		lexemeSummaryJSON, _ := json.MarshalIndent(lexemeSummary, "", "  ")

		relations := make([]relationData, 0, len(gaps.UnmappedRelations))
		for _, gap := range gaps.UnmappedRelations {
			relations = append(relations, relationData{
				RelationID:   fmt.Sprintf("%d", gap.Index),
				RelationType: gap.Relation.RelationType,
				TargetTerm:   gap.Relation.TargetTerm,
				Provider:     gap.Relation.Provider,
			})
		}
		relationsJSON, _ := json.MarshalIndent(relations, "", "  ")

		prompt += fmt.Sprintf(`Task 2: Map relations to lexeme senses
Available lexemes:
%s

Unmapped relations:
%s

Instructions:
- Map each relation to the most appropriate source lexeme ID
- Consider relation type and target term semantics

`, lexemeSummaryJSON, relationsJSON)
	}

	// Task 3: Relation scoring
	if len(gaps.UnscoredRelations) > 0 {
		relations := make([]relationData, 0, len(gaps.UnscoredRelations))
		for _, gap := range gaps.UnscoredRelations {
			strengthStr := ""
			if gap.Relation.Strength > 0 {
				strengthStr = fmt.Sprintf("%.2f", gap.Relation.Strength)
			}
			relations = append(relations, relationData{
				RelationID:   fmt.Sprintf("%d", gap.Index),
				RelationType: gap.Relation.RelationType,
				TargetTerm:   gap.Relation.TargetTerm,
				Provider:     gap.Relation.Provider,
				Strength:     strengthStr,
			})
		}
		relationsJSON, _ := json.MarshalIndent(relations, "", "  ")

		prompt += fmt.Sprintf(`Task 3: Score relation strengths
Relations needing scoring:
%s

Instructions:
- Score each relation strength from 0.0 (weak) to 1.0 (strong)
- Consider relation type, term commonality, and semantic closeness

`, relationsJSON)
	}

	// Response schema
	prompt += `Return JSON:
{
  "lexemes": [
    {
      "lexeme_id": "L...",
      "sense_gloss": "...",
      "senses": [
        {
          "language": "en",
          "gloss": "...",
          "examples": ["...", "..."]
        },
        {
          "language": "zh",
          "gloss": "...",
          "examples": ["...", "..."]
        }
      ]
    }
  ],
  "mapped_relations": [
    {
      "relation_id": "0",
      "source_lexeme_id": "L..."
    }
  ],
  "scored_relations": [
    {
      "relation_id": "0",
      "strength": 0.85
    }
  ]
}`

	return prompt
}

type llmEnrichmentResponse struct {
	Lexemes         []enrichedLexeme      `json:"lexemes"`
	MappedRelations []mappedRelation      `json:"mapped_relations"`
	ScoredRelations []scoredRelation      `json:"scored_relations"`
}

type enrichedLexeme struct {
	LexemeID   string               `json:"lexeme_id"`
	SenseGloss string               `json:"sense_gloss,omitempty"`
	Senses     []entity.LexemeSense `json:"senses,omitempty"`
}

type mappedRelation struct {
	RelationID      string `json:"relation_id"`
	SourceLexemeID  string `json:"source_lexeme_id"`
}

type scoredRelation struct {
	RelationID string  `json:"relation_id"`
	Strength   float64 `json:"strength"`
}

func (p *LLMEnrichmentProcessor) convertToEvidence(
	result *llmEnrichmentResponse,
	resp *llm.CompletionResponse,
	term string,
) []*entity.RawEvidence {
	evidence := []*entity.RawEvidence{
		{
			Provider: "llm",
			Phase:    string(pipeline.PhaseCollection),
			Content: map[string]any{
				"processor":            "llm_enrichment",
				"term":                 term,
				"model":                "llm",
				"cached":               resp.Cached,
				"token_count":          resp.TokenCount,
				"enriched_lexemes":     len(result.Lexemes),
				"mapped_relations":     len(result.MappedRelations),
				"scored_relations":     len(result.ScoredRelations),
			},
			SchemaVersion: "llm-enrichment-v2",
			FetchedAt:     time.Now(),
		},
	}

	return evidence
}

func (p *LLMEnrichmentProcessor) accumulateLLMData(pctx *pipeline.PipelineContext, result *llmEnrichmentResponse) {
	// 1. Add enriched lexemes
	enrichedByID := make(map[string]enrichedLexeme)
	for _, e := range result.Lexemes {
		enrichedByID[e.LexemeID] = e
	}

	for _, lex := range pctx.Lexemes {
		enriched, ok := enrichedByID[lex.ExternalID]
		if !ok {
			continue
		}

		// Merge enriched data
		if enriched.SenseGloss != "" && lex.SenseGloss == "" {
			lex.SenseGloss = enriched.SenseGloss
		}
		if len(enriched.Senses) > 0 {
			// Mark LLM as provider for new senses
			for i := range enriched.Senses {
				enriched.Senses[i].Provider = "llm"
			}
			lex.Senses = scoring.MergeSenses(lex.Senses, enriched.Senses)
		}
	}

	// 2. Apply sense mapping
	for _, mapped := range result.MappedRelations {
		idx := p.findRelationByID(pctx.Relations, mapped.RelationID)
		if idx >= 0 && idx < len(pctx.Relations) {
			pctx.Relations[idx].SourceExternalID = mapped.SourceLexemeID
			pctx.Relations[idx].SenseMapped = true
		}
	}

	// 3. Apply relation scoring
	for _, scored := range result.ScoredRelations {
		idx := p.findRelationByID(pctx.Relations, scored.RelationID)
		if idx >= 0 && idx < len(pctx.Relations) {
			// Clamp to [0, 1]
			strength := scored.Strength
			if strength < 0 {
				strength = 0
			}
			if strength > 1 {
				strength = 1
			}
			pctx.Relations[idx].Strength = strength
			// If original was conceptnet, we mark it as re-scored by LLM
			if pctx.Relations[idx].Provider == "conceptnet" {
				pctx.Relations[idx].Provider = "llm" // Upgrade trust
			}
		}
	}
}

func (p *LLMEnrichmentProcessor) findRelationByID(_ []*entity.SemanticRelation, id string) int {
	// RelationID in prompt is the array index
	var idx int
	if _, err := fmt.Sscanf(id, "%d", &idx); err != nil {
		return -1
	}
	return idx
}

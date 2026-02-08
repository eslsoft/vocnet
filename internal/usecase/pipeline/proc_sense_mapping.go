package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/entity"
)

// SenseMappingProcessor uses LLM to bind unmapped relations to specific Lexemes.
type SenseMappingProcessor struct {
	llm    llm.Provider
	logger *slog.Logger
}

func NewSenseMappingProcessor(provider llm.Provider, logger *slog.Logger) *SenseMappingProcessor {
	return &SenseMappingProcessor{llm: provider, logger: logger}
}

func (p *SenseMappingProcessor) Name() string { return "sense_mapping" }

func (p *SenseMappingProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.llm == nil {
		return &ProcessResult{Status: ProcessStatusSkipped, SkipReason: "llm not configured"}, nil
	}

	// Collect unmapped relations
	var unmapped []*entity.SemanticRelation
	for _, rel := range pctx.Relations {
		if !rel.SenseMapped {
			unmapped = append(unmapped, rel)
		}
	}
	if len(unmapped) == 0 || len(pctx.Lexemes) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	p.logger.Info("sense mapping", "unmapped_relations", len(unmapped), "lexemes", len(pctx.Lexemes))

	userPrompt := buildSenseMappingPrompt(pctx.Term, pctx.Lexemes, unmapped)

	resp, err := p.llm.Complete(ctx, &llm.CompletionRequest{
		SystemPrompt: "You are a lexicographic assistant. Map semantic relations to the correct lexeme sense. Always respond with valid JSON only.",
		UserPrompt:   userPrompt,
		JSONMode:     true,
	})
	if err != nil {
		return nil, fmt.Errorf("llm complete: %w", err)
	}

	// Parse response
	var result senseMappingResponse
	if err := json.Unmarshal([]byte(resp.Content), &result); err != nil {
		return nil, fmt.Errorf("parse sense mapping response: %w", err)
	}

	// Build ExternalID lookup
	validExtIDs := make(map[string]bool)
	for _, lex := range pctx.Lexemes {
		if lex.ExternalID != "" {
			validExtIDs[lex.ExternalID] = true
		}
	}

	// Apply mappings — update pctx.Relations in-place (no new relations created)
	mappingIndex := make(map[string]senseMappingEntry)
	for _, m := range result.Mappings {
		mappingIndex[m.TargetTerm+"|"+m.RelationType] = m
	}

	mappedCount := 0
	for _, rel := range pctx.Relations {
		if rel.SenseMapped {
			continue
		}
		key := rel.TargetTerm + "|" + rel.RelationType
		if m, ok := mappingIndex[key]; ok && m.LexemeID != "" {
			if validExtIDs[m.LexemeID] {
				rel.SourceExternalID = m.LexemeID
				rel.SenseMapped = true
				mappedCount++
			}
		}
	}

	evidence := &entity.RawEvidence{
		Provider: "llm",
		Phase:    int32(entity.PhaseIntellectual),
		Content: map[string]any{
			"processor":    "sense_mapping",
			"model":        "llm",
			"cached":       resp.Cached,
			"token_count":  resp.TokenCount,
			"mapped_count": mappedCount,
		},
		SchemaVersion: "llm-sense-mapping-v1",
		FetchedAt:     time.Now(),
	}

	return &ProcessResult{
		Status:   ProcessStatusExecuted,
		Evidence: []*entity.RawEvidence{evidence},
	}, nil
}

type senseMappingResponse struct {
	Mappings []senseMappingEntry `json:"mappings"`
}

type senseMappingEntry struct {
	TargetTerm   string `json:"target_term"`
	RelationType string `json:"relation_type"`
	LexemeID     string `json:"lexeme_id"` // ExternalID of the matched Lexeme
}

func buildSenseMappingPrompt(term string, lexemes []*entity.Lexeme, relations []*entity.SemanticRelation) string {
	type lexemeSummary struct {
		ExternalID string `json:"external_id"`
		POS        string `json:"pos"`
		SenseGloss string `json:"sense_gloss"`
	}
	type relationSummary struct {
		TargetTerm   string  `json:"target_term"`
		RelationType string  `json:"relation_type"`
		Strength     float64 `json:"strength"`
	}

	lexSummaries := make([]lexemeSummary, 0, len(lexemes))
	for _, lex := range lexemes {
		lexSummaries = append(lexSummaries, lexemeSummary{
			ExternalID: lex.ExternalID,
			POS:        lex.PartOfSpeech,
			SenseGloss: lex.SenseGloss,
		})
	}

	relSummaries := make([]relationSummary, 0, len(relations))
	for _, rel := range relations {
		relSummaries = append(relSummaries, relationSummary{
			TargetTerm:   rel.TargetTerm,
			RelationType: rel.RelationType,
			Strength:     rel.Strength,
		})
	}

	lexJSON, _ := json.MarshalIndent(lexSummaries, "", "  ")
	relJSON, _ := json.MarshalIndent(relSummaries, "", "  ")

	return fmt.Sprintf(`Map the following semantic relations of the word "%s" to the most appropriate lexeme.

Lexemes:
%s

Unmapped relations:
%s

For each relation, determine which lexeme (by external_id) it most likely belongs to based on the relation type and target term.

Return JSON:
{
  "mappings": [
    {
      "target_term": "...",
      "relation_type": "...",
      "lexeme_id": "L..."
    }
  ]
}

If a relation cannot be confidently mapped to any lexeme, set "lexeme_id" to "".`, term, string(lexJSON), string(relJSON))
}

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

// ScoringProcessor uses LLM to assign 0.0-1.0 strength scores to semantic relations.
type ScoringProcessor struct {
	llm    llm.Provider
	logger *slog.Logger
}

func NewScoringProcessor(provider llm.Provider, logger *slog.Logger) *ScoringProcessor {
	return &ScoringProcessor{llm: provider, logger: logger}
}

func (p *ScoringProcessor) Name() string { return "scoring" }

func (p *ScoringProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.llm == nil {
		return &ProcessResult{Status: ProcessStatusSkipped}, nil
	}

	if len(pctx.Relations) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	p.logger.Info("scoring relations", "count", len(pctx.Relations))

	userPrompt := buildScoringPrompt(pctx.Term, pctx.Relations)

	resp, err := p.llm.Complete(ctx, &llm.CompletionRequest{
		SystemPrompt: "You are a lexicographic assistant. Score semantic relations by their relevance and strength. Always respond with valid JSON only.",
		UserPrompt:   userPrompt,
		JSONMode:     true,
	})
	if err != nil {
		return nil, fmt.Errorf("llm complete: %w", err)
	}

	var result scoringResponse
	if err := json.Unmarshal([]byte(resp.Content), &result); err != nil {
		return nil, fmt.Errorf("parse scoring response: %w", err)
	}

	// Build lookup from response
	scoreIndex := make(map[string]float64)
	for _, s := range result.Scores {
		key := s.TargetTerm + "|" + s.RelationType
		scoreIndex[key] = s.Strength
	}

	// Apply scores — update pctx.Relations in-place (no new relations created)
	scoredCount := 0
	for _, rel := range pctx.Relations {
		key := rel.TargetTerm + "|" + rel.RelationType
		if score, ok := scoreIndex[key]; ok {
			rel.Strength = clamp01(score)
			scoredCount++
		}
	}

	evidence := &entity.RawEvidence{
		Provider: "llm",
		Phase:    int32(entity.PhaseIntellectual),
		Content: map[string]any{
			"processor":    "scoring",
			"model":        "llm",
			"cached":       resp.Cached,
			"token_count":  resp.TokenCount,
			"scored_count": scoredCount,
		},
		SchemaVersion: "llm-scoring-v1",
		FetchedAt:     time.Now(),
	}

	return &ProcessResult{
		Status:   ProcessStatusExecuted,
		Evidence: []*entity.RawEvidence{evidence},
	}, nil
}

type scoringResponse struct {
	Scores []relationScore `json:"scores"`
}

type relationScore struct {
	TargetTerm   string  `json:"target_term"`
	RelationType string  `json:"relation_type"`
	Strength     float64 `json:"strength"`
}

func buildScoringPrompt(term string, relations []*entity.SemanticRelation) string {
	type relSummary struct {
		TargetTerm   string  `json:"target_term"`
		RelationType string  `json:"relation_type"`
		Provider     string  `json:"provider"`
		Strength     float64 `json:"current_strength"`
	}

	summaries := make([]relSummary, 0, len(relations))
	for _, rel := range relations {
		summaries = append(summaries, relSummary{
			TargetTerm:   rel.TargetTerm,
			RelationType: rel.RelationType,
			Provider:     rel.Provider,
			Strength:     rel.Strength,
		})
	}
	relJSON, _ := json.MarshalIndent(summaries, "", "  ")

	return fmt.Sprintf(`Score the following semantic relations of the word "%s" on a scale of 0.0 to 1.0.

The score represents how significant and relevant each relation is for a language learner:
- 1.0 = essential, highly relevant relation (e.g., "happy" SYNONYM "glad")
- 0.7-0.9 = strong, commonly recognized relation
- 0.4-0.6 = moderate, somewhat useful relation
- 0.1-0.3 = weak or tangential relation
- 0.0 = irrelevant or incorrect relation

Relations:
%s

Return JSON:
{
  "scores": [
    {
      "target_term": "...",
      "relation_type": "...",
      "strength": 0.8
    }
  ]
}

Score every relation in the list.`, term, string(relJSON))
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

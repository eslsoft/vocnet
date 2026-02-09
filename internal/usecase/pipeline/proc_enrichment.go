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

// EnrichmentProcessor uses LLM to fill missing Lexeme senses, glosses, and examples.
type EnrichmentProcessor struct {
	llm    llm.Provider
	logger *slog.Logger
}

func NewEnrichmentProcessor(provider llm.Provider, logger *slog.Logger) *EnrichmentProcessor {
	return &EnrichmentProcessor{llm: provider, logger: logger}
}

func (p *EnrichmentProcessor) Name() string { return "enrichment" }

func (p *EnrichmentProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.llm == nil {
		return nil, &ErrProcessorSkipped{Reason: "llm not configured"}
	}

	// Identify incomplete lexemes
	var incomplete []*entity.Lexeme
	for _, lex := range pctx.Lexemes {
		if needsEnrichment(lex) {
			incomplete = append(incomplete, lex)
		}
	}
	if len(incomplete) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	p.logger.Info("enrichment", "incomplete_lexemes", len(incomplete))

	userPrompt := buildEnrichmentPrompt(pctx.Term, incomplete)

	resp, err := p.llm.Complete(ctx, &llm.CompletionRequest{
		SystemPrompt: "You are a lexicographic data enrichment assistant. Complete missing senses, glosses, and examples for vocabulary entries. Always respond with valid JSON only.",
		UserPrompt:   userPrompt,
		JSONMode:     true,
	})
	if err != nil {
		return nil, fmt.Errorf("llm complete: %w", err)
	}

	var result enrichmentResponse
	if err := json.Unmarshal([]byte(resp.Content), &result); err != nil {
		return nil, fmt.Errorf("parse enrichment response: %w", err)
	}

	// Apply enrichments to lexeme copies
	enrichedByID := make(map[string]enrichedLexeme)
	for _, e := range result.Lexemes {
		enrichedByID[e.LexemeID] = e
	}

	updatedLexemes := make([]*entity.Lexeme, 0)
	for _, lex := range incomplete {
		enriched, ok := enrichedByID[lex.ExternalID]
		if !ok {
			continue
		}

		updated := *lex
		if enriched.SenseGloss != "" && lex.SenseGloss == "" {
			updated.SenseGloss = enriched.SenseGloss
		}
		if len(enriched.Senses) > 0 {
			updated.Senses = mergeEnrichedSenses(lex.Senses, enriched.Senses)
		}
		updatedLexemes = append(updatedLexemes, &updated)
	}

	evidence := &entity.RawEvidence{
		Provider: "llm",
		Phase:    int32(entity.PhaseIntellectual),
		Content: map[string]any{
			"processor":      "enrichment",
			"model":          "llm",
			"cached":         resp.Cached,
			"token_count":    resp.TokenCount,
			"enriched_count": len(updatedLexemes),
		},
		SchemaVersion: "llm-enrichment-v1",
		FetchedAt:     time.Now(),
	}

	return &ProcessResult{
		Status:   ProcessStatusExecuted,
		Evidence: []*entity.RawEvidence{evidence},
		Lexemes:  updatedLexemes,
	}, nil
}

type enrichmentResponse struct {
	Lexemes []enrichedLexeme `json:"lexemes"`
}

type enrichedLexeme struct {
	LexemeID   string               `json:"lexeme_id"`
	SenseGloss string               `json:"sense_gloss"`
	Senses     []entity.LexemeSense `json:"senses"`
}

func needsEnrichment(lex *entity.Lexeme) bool {
	if lex.SenseGloss == "" {
		return true
	}
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
	for _, s := range lex.Senses {
		if len(s.Examples) < 1 {
			return true
		}
	}
	return false
}

func mergeEnrichedSenses(existing, enriched []entity.LexemeSense) []entity.LexemeSense {
	// Index existing senses by language+gloss
	seen := make(map[string]bool)
	for _, s := range existing {
		key := string(s.Language) + "|" + s.Gloss
		seen[key] = true
	}

	merged := make([]entity.LexemeSense, len(existing))
	copy(merged, existing)

	for _, s := range enriched {
		key := string(s.Language) + "|" + s.Gloss
		if !seen[key] {
			merged = append(merged, s)
			seen[key] = true
		}
	}
	return merged
}

func buildEnrichmentPrompt(term string, lexemes []*entity.Lexeme) string {
	type lexemeData struct {
		LexemeID   string               `json:"lexeme_id"`
		POS        string               `json:"pos"`
		SenseGloss string               `json:"sense_gloss"`
		Senses     []entity.LexemeSense `json:"senses"`
	}

	data := make([]lexemeData, 0, len(lexemes))
	for _, lex := range lexemes {
		data = append(data, lexemeData{
			LexemeID:   lex.ExternalID,
			POS:        string(lex.PartOfSpeech),
			SenseGloss: lex.SenseGloss,
			Senses:     lex.Senses,
		})
	}
	dataJSON, _ := json.MarshalIndent(data, "", "  ")

	return fmt.Sprintf(`Complete missing data for lexemes of the word "%s".

Current lexeme data:
%s

Instructions:
1. For each lexeme, fill in any missing fields:
   - sense_gloss: A concise English-only one-line gloss (max 10 words)
   - senses: Must include both English ("en") and Chinese ("zh") senses
   - Each sense should have at least 2 examples
2. English sense examples should be simple English sentences
3. Chinese sense examples should be English sentences with Chinese translations
4. Do NOT remove existing senses; only add missing ones
5. Keep vocabulary simpler than or equal to the target word's difficulty level

Return JSON:
{
  "lexemes": [
    {
      "lexeme_id": "L...",
      "sense_gloss": "...",
      "senses": [
        {
          "language": "en",
          "gloss": "...",
          "examples": [{"text": "...", "translation": ""}]
        },
        {
          "language": "zh",
          "gloss": "...",
          "examples": [{"text": "...", "translation": "..."}]
        }
      ]
    }
  ]
}`, term, string(dataJSON))
}

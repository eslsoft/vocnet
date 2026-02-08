package pipeline

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// CategoryInferProcessor enriches lexemes with categories inferred from their senses.
type CategoryInferProcessor struct{}

// NewCategoryInferProcessor creates a new CategoryInferProcessor.
func NewCategoryInferProcessor() *CategoryInferProcessor {
	return &CategoryInferProcessor{}
}

func (p *CategoryInferProcessor) Name() string { return "category-infer" }

func (p *CategoryInferProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if len(pctx.Lexemes) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	enriched := make([]*entity.Lexeme, 0, len(pctx.Lexemes))
	for _, lex := range pctx.Lexemes {
		categories := InferCategoriesFromSenses(lex.Senses)
		if len(categories) > 0 {
			updated := *lex
			updated.Categories = appendUnique(lex.Categories, categories...)
			enriched = append(enriched, &updated)
		}
	}

	if len(enriched) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	return &ProcessResult{
		Status:  ProcessStatusExecuted,
		Lexemes: enriched,
	}, nil
}

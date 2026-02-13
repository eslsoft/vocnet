package pipeline

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eslsoft/vocnet/internal/repository"
)

// GenericSourceProcessor wraps any SourceProvider as a pipeline Processor.
// It translates PipelineContext into SourceQuery and SourceResult back into ProcessResult.
type GenericSourceProcessor struct {
	source repository.SourceProvider
	logger *slog.Logger
}

// NewGenericSourceProcessor creates a generic processor from a SourceProvider.
func NewGenericSourceProcessor(source repository.SourceProvider, logger *slog.Logger) *GenericSourceProcessor {
	return &GenericSourceProcessor{source: source, logger: logger}
}

func (p *GenericSourceProcessor) Name() string {
	return p.source.Manifest().Name
}

func (p *GenericSourceProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.source == nil {
		return nil, &ErrProcessorSkipped{Reason: p.Name() + " not available"}
	}

	query := buildSourceQuery(pctx)
	result, err := p.source.Lookup(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("%s lookup: %w", p.Name(), err)
	}
	if result == nil {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	return sourceResultToProcessResult(result), nil
}

func buildSourceQuery(pctx *PipelineContext) repository.SourceQuery {
	query := repository.SourceQuery{
		Term:     pctx.Term,
		Language: pctx.Language.Code(),
		Context: &repository.SourceContext{
			Lexemes:   pctx.Lexemes,
			Forms:     pctx.Forms,
			Relations: pctx.Relations,
			Lemma:     pctx.Lemma,
		},
	}
	return query
}

func sourceResultToProcessResult(sr *repository.SourceResult) *ProcessResult {
	pr := &ProcessResult{
		Status:        ProcessStatusExecuted,
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
		pr.Status = ProcessStatusNoData
	}

	return pr
}

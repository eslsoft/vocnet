package pipeline

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eslsoft/vocnet/internal/repository"
)

// GenericSourceProcessor wraps any SourceProvider as a pipeline Processor.
// It sends only term+language to the source, then converts the raw
// SourceResult back into a ProcessResult for the pipeline.
type GenericSourceProcessor struct {
	source   repository.SourceProvider
	logger   *slog.Logger
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
		logger:   logger,
		provider: providerName,
	}
}

func (p *GenericSourceProcessor) Name() string {
	return p.provider
}

func (p *GenericSourceProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.source == nil {
		return nil, &ErrProcessorSkipped{Reason: p.Name() + " not available"}
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
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	pr := sourceResultToProcessResult(result)
	// Attach provider name to ProcessResult for evaluator
	pr.Provider = p.provider
	return pr, nil
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

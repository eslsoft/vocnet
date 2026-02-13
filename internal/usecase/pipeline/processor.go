package pipeline

import (
	"context"
	"errors"
	"fmt"

	"github.com/eslsoft/vocnet/internal/entity"
)

// ProcessStatus indicates the outcome of a processor execution.
type ProcessStatus int

const (
	ProcessStatusExecuted ProcessStatus = iota
	ProcessStatusNoData                 // Ran but source had no data
)

// ErrProcessorSkipped signals that a processor cannot run because its
// dependency (provider, reader, etc.) is not configured. The caller
// decides whether to skip or abort.
type ErrProcessorSkipped struct {
	Reason string
}

func (e *ErrProcessorSkipped) Error() string {
	return fmt.Sprintf("processor skipped: %s", e.Reason)
}

// IsProcessorSkipped returns true if err (or any wrapped error) is ErrProcessorSkipped.
func IsProcessorSkipped(err error) bool {
	var target *ErrProcessorSkipped
	return errors.As(err, &target)
}

// Processor is the smallest work unit in the pipeline.
// Processors are pure data transformers: they read PipelineContext + their own data source
// and produce a ProcessResult. They must NOT have repository dependencies.
type Processor interface {
	Name() string
	Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error)
}

// ProcessResult contains the outputs of a single processor execution.
type ProcessResult struct {
	Status        ProcessStatus
	Evidence      []*entity.RawEvidence
	Lexemes       []*entity.Lexeme
	Relations     []*entity.SemanticRelation
	Forms         []*entity.LemmaForm
	FormsByLexeme map[string][]*entity.LemmaForm // forms grouped by Lexeme ExternalID
	LemmaUpdate   *entity.Lemma                  // non-nil → update lemma
	LemmaSnapshot *entity.LemmaSnapshot          // only set by LemmaSnapshotProcessor
	Provider      string                         // source provider name (for evaluator)
}

// PipelineContext carries accumulated state through all pipeline stages.
type PipelineContext struct {
	Term     string
	Language entity.Language
	Tier     int32

	Lemma         *entity.Lemma
	Lexemes       []*entity.Lexeme
	Relations     []*entity.SemanticRelation
	Forms         []*entity.LemmaForm
	FormsByLexeme map[string][]*entity.LemmaForm
	Evidence      []*entity.RawEvidence
	LemmaSnapshot *entity.LemmaSnapshot

	// Evaluator for data quality assessment (optional)
	Evaluator *DataEvaluator
}

// Accumulate merges a ProcessResult into the pipeline context.
// If an evaluator is configured, it uses scoring to make adoption decisions.
func (pc *PipelineContext) Accumulate(r *ProcessResult) {
	pc.AccumulateWithProvider(r, "")
}

// AccumulateWithProvider merges a ProcessResult with provider metadata.
// The provider string is required for evaluator-based adoption decisions.
// If evaluator is not configured, this will panic - evaluator is now mandatory.
func (pc *PipelineContext) AccumulateWithProvider(r *ProcessResult, provider string) {
	if r == nil {
		return
	}

	if pc.Evaluator == nil {
		panic("PipelineContext.Evaluator is nil - evaluator must be configured")
	}

	// Evidence: always accumulate
	if r.Evidence != nil {
		pc.Evidence = append(pc.Evidence, r.Evidence...)
	}

	// Relations: always accumulate (deduplication happens at persistence)
	if r.Relations != nil {
		pc.Relations = append(pc.Relations, r.Relations...)
	}

	// Lexemes: evaluate and merge with quality scoring
	if r.Lexemes != nil {
		merged, _ := pc.Evaluator.EvaluateAndMergeLexemes(pc.Lexemes, r.Lexemes, provider)
		pc.Lexemes = merged
	}

	// Forms: evaluate and merge with quality scoring
	if r.Forms != nil {
		merged, _ := pc.Evaluator.EvaluateAndMergeForms(pc.Forms, r.Forms, provider)
		pc.Forms = merged
	}

	// FormsByLexeme: merge (no evaluation needed - keyed by lexeme)
	if r.FormsByLexeme != nil {
		pc.FormsByLexeme = mergeFormsByLexeme(pc.FormsByLexeme, r.FormsByLexeme)
	}

	// LemmaUpdate: evaluate and merge with quality scoring
	if r.LemmaUpdate != nil {
		merged, _ := pc.Evaluator.EvaluateAndMergeLemmaUpdate(pc.Lemma, r.LemmaUpdate, provider)
		merged.ID = pc.Lemma.ID // Preserve ID
		pc.Lemma = merged
	}

	// LemmaSnapshot: always overwrite (latest snapshot)
	if r.LemmaSnapshot != nil {
		pc.LemmaSnapshot = r.LemmaSnapshot
	}
}

func mergeFormsByLexeme(existing, incoming map[string][]*entity.LemmaForm) map[string][]*entity.LemmaForm {
	if len(incoming) == 0 {
		return existing
	}
	if existing == nil {
		existing = make(map[string][]*entity.LemmaForm, len(incoming))
	}

	// Use evaluator's merge logic if forms need merging
	for lexemeID, incomingForms := range incoming {
		existingForms := existing[lexemeID]

		// Simple append for FormsByLexeme - detailed evaluation happens in Forms field
		index := make(map[string]int)
		for i, f := range existingForms {
			key := f.Surface + ":" + string(f.FormType)
			index[key] = i
		}

		for _, f := range incomingForms {
			key := f.Surface + ":" + string(f.FormType)
			if _, ok := index[key]; !ok {
				existingForms = append(existingForms, f)
			}
		}
		existing[lexemeID] = existingForms
	}
	return existing
}

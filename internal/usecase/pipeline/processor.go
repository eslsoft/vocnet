package pipeline

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// ProcessStatus indicates the outcome of a processor execution.
type ProcessStatus int

const (
	ProcessStatusExecuted ProcessStatus = iota
	ProcessStatusSkipped                // Processor chose to skip (nil reader)
	ProcessStatusNoData                 // Ran but source had no data
)

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
	SkipReason    string // human-readable reason when Status == ProcessStatusSkipped
	Evidence      []*entity.RawEvidence
	Lexemes       []*entity.Lexeme
	Relations     []*entity.SemanticRelation
	Forms         []*entity.LemmaForm
	FormsByLexeme map[string][]*entity.LemmaForm // forms grouped by Lexeme ExternalID
	LemmaUpdate   *entity.Lemma                  // non-nil → update lemma (e.g., QID)
	Snapshot      *entity.WordSnapshot            // only set by SnapshotProcessor
}

// PipelineContext carries accumulated state through all pipeline stages.
type PipelineContext struct {
	Term     string
	Language entity.Language
	Tier     int32

	Lemma     *entity.Lemma
	Lexemes   []*entity.Lexeme
	Relations []*entity.SemanticRelation
	Forms     []*entity.LemmaForm
	Evidence  []*entity.RawEvidence
	Snapshot  *entity.WordSnapshot
}

// Accumulate merges a ProcessResult into the pipeline context.
func (pc *PipelineContext) Accumulate(r *ProcessResult) {
	if r == nil {
		return
	}

	if r.Evidence != nil {
		pc.Evidence = append(pc.Evidence, r.Evidence...)
	}
	if r.Lexemes != nil {
		pc.Lexemes = mergeLexemes(pc.Lexemes, r.Lexemes)
	}
	if r.Relations != nil {
		pc.Relations = append(pc.Relations, r.Relations...)
	}
	if r.Forms != nil {
		pc.Forms = mergeForms(pc.Forms, r.Forms)
	}
	if r.LemmaUpdate != nil {
		// Apply lemma updates to context
		updated := *r.LemmaUpdate
		updated.ID = pc.Lemma.ID
		pc.Lemma = &updated
	}
	if r.Snapshot != nil {
		pc.Snapshot = r.Snapshot
	}
}

// mergeLexemes merges new lexemes into existing list, updating by ExternalID if matched.
func mergeLexemes(existing, new []*entity.Lexeme) []*entity.Lexeme {
	byExtID := make(map[string]int) // ExternalID → index in existing
	for i, lex := range existing {
		if lex.ExternalID != "" {
			byExtID[lex.ExternalID] = i
		}
	}

	for _, lex := range new {
		if idx, ok := byExtID[lex.ExternalID]; ok && lex.ExternalID != "" {
			existing[idx] = lex // update in-place
		} else {
			existing = append(existing, lex)
		}
	}
	return existing
}

// mergeForms merges new forms into existing list, deduplicating by surface+formType.
func mergeForms(existing, new []*entity.LemmaForm) []*entity.LemmaForm {
	seen := make(map[string]bool)
	for _, f := range existing {
		key := f.Surface + ":" + string(f.FormType)
		seen[key] = true
	}
	for _, f := range new {
		key := f.Surface + ":" + string(f.FormType)
		if !seen[key] {
			existing = append(existing, f)
			seen[key] = true
		}
	}
	return existing
}

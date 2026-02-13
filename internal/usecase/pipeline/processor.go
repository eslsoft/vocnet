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
	if r.FormsByLexeme != nil {
		pc.FormsByLexeme = mergeFormsByLexeme(pc.FormsByLexeme, r.FormsByLexeme)
	}
	if r.LemmaUpdate != nil {
		// Apply lemma updates to context
		updated := *r.LemmaUpdate
		updated.ID = pc.Lemma.ID
		pc.Lemma = &updated
	}
	if r.LemmaSnapshot != nil {
		pc.LemmaSnapshot = r.LemmaSnapshot
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
// When a form already exists, enrichment fields (phonetics, syllables) are merged in.
func mergeForms(existing, new []*entity.LemmaForm) []*entity.LemmaForm {
	index := make(map[string]int, len(existing)) // key → index in existing
	for i, f := range existing {
		key := f.Surface + ":" + string(f.FormType)
		index[key] = i
	}
	for _, f := range new {
		key := f.Surface + ":" + string(f.FormType)
		if idx, ok := index[key]; ok {
			mergeFormFields(existing[idx], f)
		} else {
			index[key] = len(existing)
			existing = append(existing, f)
		}
	}
	return existing
}

// mergeFormFields enriches dst with non-empty fields from src.
func mergeFormFields(dst, src *entity.LemmaForm) {
	if len(src.Syllables) > 0 && len(dst.Syllables) == 0 {
		dst.Syllables = src.Syllables
	}
	if len(src.Phonetics) > 0 {
		dst.Phonetics = mergePhonetics(dst.Phonetics, src.Phonetics)
	}
	if src.IsIrregular && !dst.IsIrregular {
		dst.IsIrregular = true
	}
}

// mergePhonetics appends new phonetics that don't already exist.
func mergePhonetics(existing, incoming []entity.Phonetic) []entity.Phonetic {
	seen := make(map[string]struct{}, len(existing))
	for _, ph := range existing {
		seen[ph.IPA+"|"+ph.Dialect] = struct{}{}
	}
	for _, ph := range incoming {
		key := ph.IPA + "|" + ph.Dialect
		if _, ok := seen[key]; !ok {
			existing = append(existing, ph)
			seen[key] = struct{}{}
		}
	}
	return existing
}

func mergeFormsByLexeme(existing, incoming map[string][]*entity.LemmaForm) map[string][]*entity.LemmaForm {
	if len(incoming) == 0 {
		return existing
	}
	if existing == nil {
		existing = make(map[string][]*entity.LemmaForm, len(incoming))
	}
	for lexemeID, forms := range incoming {
		existing[lexemeID] = mergeForms(existing[lexemeID], forms)
	}
	return existing
}

package pipeline

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

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

	// EvaluatedFragments stores quality-scored fragments for integration phase
	// Key: field key (e.g., "lexeme:en:verb", "form:run:phonetics")
	// Value: list of competing fragments from different providers
	EvaluatedFragments map[string][]*FieldFragment

	// mu protects concurrent access during parallel processor execution
	mu sync.Mutex
}

// Accumulate merges a ProcessResult into the pipeline context.
// If an evaluator is configured, it uses scoring to make adoption decisions.
// Uses the result's Provider field if available.
func (pc *PipelineContext) Accumulate(r *ProcessResult) {
	provider := ""
	if r != nil {
		provider = r.Provider
	}
	pc.AccumulateWithProvider(r, provider)
}

// AccumulateWithProvider merges a ProcessResult with provider metadata.
// The provider string is required for evaluator-based adoption decisions.
// This method is safe for concurrent use.
func (pc *PipelineContext) AccumulateWithProvider(r *ProcessResult, provider string) {
	if r == nil {
		return
	}

	if pc.Evaluator == nil {
		panic("PipelineContext.Evaluator is nil - evaluator must be configured")
	}

	pc.mu.Lock()
	defer pc.mu.Unlock()

	// Evidence: always accumulate
	if r.Evidence != nil {
		pc.Evidence = append(pc.Evidence, r.Evidence...)
	}

	// Relations: accumulate with scoring-based deduplication
	if r.Relations != nil {
		pc.Relations = mergeRelationsWithScoring(pc.Relations, r.Relations, pc.Evaluator.scorer)
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

// mergeRelationsWithScoring deduplicates relations by key, keeping the higher-scored one.
func mergeRelationsWithScoring(existing, incoming []*entity.SemanticRelation, scorer FieldScorer) []*entity.SemanticRelation {
	if len(incoming) == 0 {
		return existing
	}

	// Build index of existing relations by dedup key
	type indexEntry struct {
		idx   int
		score float64
	}
	index := make(map[string]indexEntry, len(existing))
	for i, rel := range existing {
		key := relationDeduplicationKey(rel)
		if key == "" {
			continue
		}
		index[key] = indexEntry{idx: i, score: scorer.ScoreRelation(rel).Score}
	}

	for _, rel := range incoming {
		key := relationDeduplicationKey(rel)
		if key == "" {
			existing = append(existing, rel)
			continue
		}
		newScore := scorer.ScoreRelation(rel).Score
		if entry, ok := index[key]; ok {
			// Duplicate: keep higher score, break ties by provider trust
			if newScore > entry.score ||
				(newScore == entry.score && sourceProviderTrustRank(rel.Provider) > sourceProviderTrustRank(existing[entry.idx].Provider)) {
				existing[entry.idx] = rel
				index[key] = indexEntry{idx: entry.idx, score: newScore}
			}
		} else {
			idx := len(existing)
			existing = append(existing, rel)
			index[key] = indexEntry{idx: idx, score: newScore}
		}
	}
	return existing
}

// relationDeduplicationKey creates a key for relation deduplication.
func relationDeduplicationKey(rel *entity.SemanticRelation) string {
	if rel == nil {
		return ""
	}
	// Use source external ID + target term + relation type as the key
	return rel.SourceExternalID + "|" + strings.ToLower(strings.TrimSpace(rel.TargetTerm)) + "|" + rel.RelationType
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

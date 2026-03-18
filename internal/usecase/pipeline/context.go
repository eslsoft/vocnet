package pipeline

import (
	"strings"
	"sync"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
	"github.com/eslsoft/vocnet/pkg/pipeline"
)

// --- Phases ---

// PipelinePhase represents a logical phase in the data processing pipeline.
type PipelinePhase string

const (
	// PhaseCollection: Concurrent data acquisition from all sources with contract validation
	PhaseCollection PipelinePhase = "collection"

	// PhaseEvaluation: Quality scoring of collected data fragments
	PhaseEvaluation PipelinePhase = "evaluation"

	// PhaseIntegration: Smart merging of fragments based on quality scores
	PhaseIntegration PipelinePhase = "integration"

	// PhaseSnapshot: Final snapshot generation
	PhaseSnapshot PipelinePhase = "snapshot"
)

// PhaseFromNumber returns the phase name for a given stage number.
func PhaseFromNumber(num int32) PipelinePhase {
	switch num {
	case 1, 2: // Collection (including LLM enrichment)
		return PhaseCollection
	case 3:
		return PhaseEvaluation
	case 4:
		return PhaseIntegration
	case 5:
		return PhaseSnapshot
	default:
		return "unknown"
	}
}

// --- Process Types ---

type ProcessStatus = scoring.ProcessStatus
type ProcessResult = scoring.ProcessResult

const (
	ProcessStatusExecuted = scoring.ProcessStatusExecuted
	ProcessStatusNoData   = scoring.ProcessStatusNoData
)

type Processor = pipeline.Processor[*PipelineContext, *ProcessResult]
type Stage = pipeline.Stage[*PipelineContext, *ProcessResult]

// NewStage creates a new sequential stage.
func NewStage(name string, number int, processors ...Processor) *Stage {
	return pipeline.NewStage[*PipelineContext, *ProcessResult](name, number, processors...)
}

// NewConcurrentStage creates a stage where processors run concurrently.
func NewConcurrentStage(name string, number int, processors ...Processor) *Stage {
	return pipeline.NewConcurrentStage[*PipelineContext, *ProcessResult](name, number, processors...)
}

// ErrProcessorSkipped is re-exported from pkg/pipeline.
type ErrProcessorSkipped = pipeline.ErrProcessorSkipped

// --- Context ---

// PipelineContext carries accumulated state through all pipeline stages.
type PipelineContext struct {
	JobID    int64
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

	// VariantSurfaces stores spelling variants collected from Wikidata
	VariantSurfaces []string

	// ProcessResults stores results from each processor for fragment evaluation
	ProcessResults []*ProcessResult

	// Evaluator for data quality assessment (optional)
	Evaluator *scoring.DataEvaluator

	// EvaluatedFragments stores quality-scored fragments for integration phase
	EvaluatedFragments map[string][]*scoring.FieldFragment

	// mu protects concurrent access during parallel processor execution
	mu sync.Mutex
}

// Accumulate merges a ProcessResult into the pipeline context.
func (pc *PipelineContext) Accumulate(r *ProcessResult) {
	provider := ""
	if r != nil {
		provider = r.Provider
	}
	pc.AccumulateWithProvider(r, provider)
}

// AccumulateWithProvider merges a ProcessResult with provider metadata.
func (pc *PipelineContext) AccumulateWithProvider(r *ProcessResult, provider string) {
	if r == nil {
		return
	}

	if pc.Evaluator == nil {
		panic("PipelineContext.Evaluator is nil - evaluator must be configured")
	}

	pc.mu.Lock()
	defer pc.mu.Unlock()

	if r.Provider == "" {
		r.Provider = provider
	}
	pc.ProcessResults = append(pc.ProcessResults, r)

	if len(r.VariantSurfaces) > 0 {
		pc.VariantSurfaces = mergeVariantSurfaces(pc.VariantSurfaces, r.VariantSurfaces)
	}

	if r.Evidence != nil {
		pc.Evidence = append(pc.Evidence, r.Evidence...)
	}

	if r.Relations != nil {
		pc.Relations = mergeRelationsWithScoring(pc.Relations, r.Relations, pc.Evaluator)
	}

	if r.Lexemes != nil {
		merged, _ := pc.Evaluator.EvaluateAndMergeLexemes(pc.Lexemes, r.Lexemes, provider)
		pc.Lexemes = merged
	}

	if r.Forms != nil {
		merged, _ := pc.Evaluator.EvaluateAndMergeForms(pc.Forms, r.Forms, provider)
		pc.Forms = merged
	}

	if r.FormsByLexeme != nil {
		pc.FormsByLexeme = mergeFormsByLexeme(pc.FormsByLexeme, r.FormsByLexeme)
	}

	if r.LemmaSnapshot != nil {
		pc.LemmaSnapshot = r.LemmaSnapshot
	}
}

func mergeRelationsWithScoring(existing, incoming []*entity.SemanticRelation, _ *scoring.DataEvaluator) []*entity.SemanticRelation {
	// Simple merge for now
	return append(existing, incoming...)
}

func mergeVariantSurfaces(existing, incoming []string) []string {
	seen := make(map[string]struct{}, len(existing))
	for _, v := range existing {
		seen[strings.ToLower(v)] = struct{}{}
	}
	for _, v := range incoming {
		lower := strings.ToLower(v)
		if _, ok := seen[lower]; !ok {
			seen[lower] = struct{}{}
			existing = append(existing, v)
		}
	}
	return existing
}

func mergeFormsByLexeme(existing, incoming map[string][]*entity.LemmaForm) map[string][]*entity.LemmaForm {
	if existing == nil {
		existing = make(map[string][]*entity.LemmaForm)
	}
	for k, v := range incoming {
		existing[k] = append(existing[k], v...)
	}
	return existing
}

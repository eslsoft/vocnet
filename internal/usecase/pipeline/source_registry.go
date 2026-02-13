package pipeline

import (
	"log/slog"
	"sort"

	"github.com/eslsoft/vocnet/internal/repository"
)

// stageOrder defines the canonical execution order for pipeline stages.
// Maps old stage names to new phases and their order.
var stageOrder = map[string]int{
	"discovery":    1,
	"lexical":      2,
	"relational":   3,
	"intellectual": 4,
	"synthesis":    5,
}

// stageToPhase maps old stage names to new PipelinePhase constants.
var stageToPhase = map[string]PipelinePhase{
	"discovery":    PhaseCollection,
	"lexical":      PhaseCollection,
	"relational":   PhaseCollection,
	"intellectual": PhaseEvaluation,
	"synthesis":    PhaseSnapshot,
}

// SourceRegistry manages the collection of SourceProviders and builds pipeline stages.
type SourceRegistry struct {
	sources []repository.SourceProvider
	logger  *slog.Logger
}

// NewSourceRegistry creates a new SourceRegistry.
func NewSourceRegistry(logger *slog.Logger) *SourceRegistry {
	return &SourceRegistry{logger: logger}
}

// Register adds a SourceProvider to the registry.
func (r *SourceRegistry) Register(source repository.SourceProvider) {
	r.sources = append(r.sources, source)
	m := source.Manifest()
	r.logger.Info("registered source provider",
		"name", m.Name,
		"kind", m.Kind,
		"stage", m.Stage,
		"capabilities", m.Capabilities,
		"languages", m.Languages,
	)
}

// Sources returns all registered SourceProviders.
func (r *SourceRegistry) Sources() []repository.SourceProvider {
	return r.sources
}

// BuildStages creates pipeline stages from registered sources and additional specialized processors.
// specialProcessors maps stage name to processors that are not SourceProvider-based
// (e.g., CategoryInfer, SenseMapping, Enrichment, Scoring, Snapshot).
func (r *SourceRegistry) BuildStages(specialProcessors map[string][]Processor) []*Stage {
	// Group source-based processors by stage
	stageProcessors := make(map[string][]Processor)
	for _, src := range r.sources {
		m := src.Manifest()
		proc := NewGenericSourceProcessor(src, r.logger)
		stageProcessors[m.Stage] = append(stageProcessors[m.Stage], proc)
	}

	// Merge with special processors (appended after source processors)
	for stageName, procs := range specialProcessors {
		stageProcessors[stageName] = append(stageProcessors[stageName], procs...)
	}

	// Collect all stage names and sort by canonical order
	stageNames := make([]string, 0, len(stageProcessors))
	for name := range stageProcessors {
		stageNames = append(stageNames, name)
	}
	sort.Slice(stageNames, func(i, j int) bool {
		oi, ok := stageOrder[stageNames[i]]
		if !ok {
			oi = 99
		}
		oj, ok := stageOrder[stageNames[j]]
		if !ok {
			oj = 99
		}
		return oi < oj
	})

	stages := make([]*Stage, 0, len(stageNames))
	for _, name := range stageNames {
		procs := stageProcessors[name]
		if len(procs) == 0 {
			continue
		}
		number, ok := stageOrder[name]
		if !ok {
			number = 99
		}
		// Map old stage name to new phase
		phase, ok := stageToPhase[name]
		if !ok {
			// Default to collection for unknown stages
			phase = PhaseCollection
		}
		stages = append(stages, NewStage(phase, number, procs...))
	}

	return stages
}

// CloseAll closes all registered source providers.
func (r *SourceRegistry) CloseAll() {
	for _, src := range r.sources {
		if err := src.Close(); err != nil {
			r.logger.Warn("failed to close source provider", "name", src.Manifest().Name, "error", err)
		}
	}
}

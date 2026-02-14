package engine

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

// Stage groups related processors into a logical pipeline stage.
type Stage struct {
	Phase      PipelinePhase
	Number     int
	Processors []Processor
	Concurrent bool // Whether processors in this stage can run concurrently
}

// NewStage creates a new stage with the given processors.
func NewStage(phase PipelinePhase, number int, processors ...Processor) *Stage {
	return &Stage{
		Phase:      phase,
		Number:     number,
		Processors: processors,
		Concurrent: false, // Default to sequential execution
	}
}

// NewConcurrentStage creates a stage where processors run concurrently.
func NewConcurrentStage(phase PipelinePhase, number int, processors ...Processor) *Stage {
	return &Stage{
		Phase:      phase,
		Number:     number,
		Processors: processors,
		Concurrent: true,
	}
}

package pipeline

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

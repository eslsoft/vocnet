package pipeline

// Stage groups related processors into a logical pipeline stage.
type Stage struct {
	Name       string
	Number     int
	Processors []Processor
}

// NewStage creates a new stage with the given processors.
func NewStage(name string, number int, processors ...Processor) *Stage {
	return &Stage{
		Name:       name,
		Number:     number,
		Processors: processors,
	}
}

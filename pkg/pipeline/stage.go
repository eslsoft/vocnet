package pipeline

// Stage groups related processors into a logical pipeline stage.
type Stage[T any, R any] struct {
	Name       string
	Number     int
	Processors []Processor[T, R]
	Concurrent bool // Whether processors in this stage can run concurrently
}

// NewStage creates a new sequential stage.
func NewStage[T any, R any](name string, number int, processors ...Processor[T, R]) *Stage[T, R] {
	return &Stage[T, R]{
		Name:       name,
		Number:     number,
		Processors: processors,
		Concurrent: false,
	}
}

// NewConcurrentStage creates a new concurrent stage.
func NewConcurrentStage[T any, R any](name string, number int, processors ...Processor[T, R]) *Stage[T, R] {
	return &Stage[T, R]{
		Name:       name,
		Number:     number,
		Processors: processors,
		Concurrent: true,
	}
}

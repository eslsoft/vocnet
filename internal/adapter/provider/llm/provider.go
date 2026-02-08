package llm

import "context"

// Provider defines the interface for LLM completion services.
type Provider interface {
	Complete(ctx context.Context, req *CompletionRequest) (*CompletionResponse, error)
}

// CompletionRequest contains the parameters for an LLM completion call.
type CompletionRequest struct {
	SystemPrompt string
	UserPrompt   string
	JSONMode     bool // Use response_format: json_object
}

// CompletionResponse contains the result of an LLM completion call.
type CompletionResponse struct {
	Content    string
	TokenCount int32
	Cached     bool // true when served from DistillCache
}

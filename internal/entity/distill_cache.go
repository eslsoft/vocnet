package entity

import "time"

// DistillCache stores cached LLM distillation responses.
type DistillCache struct {
	ID            int64
	ContextHash   string // SHA256(Context + Prompt + Model)
	Model         string
	PromptSummary string
	Response      map[string]any
	TokenCount    int32
	CreatedAt     time.Time
}

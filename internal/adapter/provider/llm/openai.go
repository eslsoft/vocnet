package llm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// OpenAIProvider implements Provider using the OpenAI-compatible chat completions API.
type OpenAIProvider struct {
	baseURL    string
	apiKey     string
	model      string
	cache      repository.DistillCacheRepository
	httpClient *http.Client
}

// NewOpenAIProvider creates a new OpenAI-compatible LLM provider with transparent caching.
func NewOpenAIProvider(baseURL, apiKey, model string, cache repository.DistillCacheRepository) *OpenAIProvider {
	return &OpenAIProvider{
		baseURL: baseURL,
		apiKey:  apiKey,
		model:   model,
		cache:   cache,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

type chatRequest struct {
	Model          string           `json:"model"`
	Messages       []chatMessage    `json:"messages"`
	MaxTokens      int              `json:"max_completion_tokens,omitempty"`
	Temperature    float64          `json:"temperature,omitempty"`
	ResponseFormat *responseFormat  `json:"response_format,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responseFormat struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		TotalTokens int32 `json:"total_tokens"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

func (p *OpenAIProvider) Complete(ctx context.Context, req *CompletionRequest) (*CompletionResponse, error) {
	contextHash := computeHash(req.SystemPrompt, req.UserPrompt, p.model)

	// Check cache
	if p.cache != nil {
		cached, err := p.cache.FindByHash(ctx, contextHash)
		if err == nil && cached != nil {
			content, _ := cached.Response["content"].(string)
			return &CompletionResponse{
				Content:    content,
				TokenCount: cached.TokenCount,
				Cached:     true,
			}, nil
		}
	}

	// Build API request
	apiReq := chatRequest{
		Model:       p.model,
		MaxTokens:   8192,
		Temperature: 0.1,
		Messages: []chatMessage{
			{Role: "system", Content: req.SystemPrompt},
			{Role: "user", Content: req.UserPrompt},
		},
	}
	if req.JSONMode {
		apiReq.ResponseFormat = &responseFormat{Type: "json_object"}
	}

	body, err := json.Marshal(apiReq)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := p.baseURL + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var apiResp chatResponse
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if apiResp.Error != nil {
		return nil, fmt.Errorf("API error: %s - %s", apiResp.Error.Type, apiResp.Error.Message)
	}

	if len(apiResp.Choices) == 0 {
		return nil, fmt.Errorf("empty response choices")
	}

	content := apiResp.Choices[0].Message.Content
	var tokenCount int32
	if apiResp.Usage != nil {
		tokenCount = apiResp.Usage.TotalTokens
	}

	// Store in cache
	if p.cache != nil {
		_, _ = p.cache.Create(ctx, &entity.DistillCache{
			ContextHash:   contextHash,
			Model:         p.model,
			PromptSummary: truncate(req.SystemPrompt, 200),
			Response:      map[string]any{"content": content},
			TokenCount:    tokenCount,
		})
	}

	return &CompletionResponse{
		Content:    content,
		TokenCount: tokenCount,
		Cached:     false,
	}, nil
}

func computeHash(systemPrompt, userPrompt, model string) string {
	h := sha256.New()
	h.Write([]byte(systemPrompt))
	h.Write([]byte{0}) // null separator to prevent field-boundary collisions
	h.Write([]byte(userPrompt))
	h.Write([]byte{0})
	h.Write([]byte(model))
	return fmt.Sprintf("%x", h.Sum(nil))
}

func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen])
}

package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenAIProvider_Complete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "/chat/completions", r.URL.Path)

		resp := chatResponse{
			Choices: []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
				FinishReason string `json:"finish_reason"`
			}{
				{
					Message: struct {
						Content string `json:"content"`
					}{Content: `{"result": "ok"}`},
					FinishReason: "stop",
				},
			},
			Usage: &struct {
				TotalTokens int32 `json:"total_tokens"`
			}{TotalTokens: 42},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	provider := NewOpenAIProvider(server.URL, "test-key", "test-model", nil)

	resp, err := provider.Complete(context.Background(), &CompletionRequest{
		SystemPrompt: "You are a test.",
		UserPrompt:   "Say hello.",
		JSONMode:     true,
	})

	require.NoError(t, err)
	assert.Equal(t, `{"result": "ok"}`, resp.Content)
	assert.Equal(t, int32(42), resp.TokenCount)
	assert.False(t, resp.Cached)
}

func TestOpenAIProvider_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error": {"type": "rate_limit", "message": "rate limited"}}`))
	}))
	defer server.Close()

	provider := NewOpenAIProvider(server.URL, "test-key", "test-model", nil)

	_, err := provider.Complete(context.Background(), &CompletionRequest{
		SystemPrompt: "test",
		UserPrompt:   "test",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "429")
}

func TestOpenAIProvider_CacheHit(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		resp := chatResponse{
			Choices: []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
				FinishReason string `json:"finish_reason"`
			}{
				{
					Message: struct {
						Content string `json:"content"`
					}{Content: `{"data": "fresh"}`},
					FinishReason: "stop",
				},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	cache := &mockCache{}
	provider := NewOpenAIProvider(server.URL, "test-key", "test-model", cache)

	// First call - cache miss, hits API
	resp1, err := provider.Complete(context.Background(), &CompletionRequest{
		SystemPrompt: "sys",
		UserPrompt:   "user",
	})
	require.NoError(t, err)
	assert.False(t, resp1.Cached)
	assert.Equal(t, 1, callCount)
	assert.NotNil(t, cache.stored) // should have stored in cache

	// Second call - cache hit, no API call
	resp2, err := provider.Complete(context.Background(), &CompletionRequest{
		SystemPrompt: "sys",
		UserPrompt:   "user",
	})
	require.NoError(t, err)
	assert.True(t, resp2.Cached)
	assert.Equal(t, 1, callCount) // API should NOT be called again
	assert.Equal(t, `{"data": "fresh"}`, resp2.Content)
}

func TestComputeHash(t *testing.T) {
	h1 := computeHash("sys", "user", "model")
	h2 := computeHash("sys", "user", "model")
	h3 := computeHash("sys", "user2", "model")

	assert.Equal(t, h1, h2, "same inputs should produce same hash")
	assert.NotEqual(t, h1, h3, "different inputs should produce different hash")
	assert.Len(t, h1, 64, "SHA256 hex should be 64 chars")
}

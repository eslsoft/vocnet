package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
)

const (
	openaiAPIURL = "https://api.openai.com/v1/chat/completions"
	openaiModel  = "gpt-5-mini"
	maxTokens    = 4096
)

type ClaudeClient struct {
	apiKey     string
	httpClient *http.Client
}

func NewClaudeClient(apiKey string) *ClaudeClient {
	return &ClaudeClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

// Alias for better naming when using OpenAI
type OpenAIClient = ClaudeClient

func NewOpenAIClient(apiKey string) *OpenAIClient {
	return NewClaudeClient(apiKey)
}

type CleanSensesRequest struct {
	Lemma      string
	POS        string
	LexemeID   string // Wikidata lexeme ID
	Senses     []entity.LexemeSense
	SenseGloss string // Existing sense gloss (may be empty)
}

type CleanSensesResponse struct {
	SenseGloss string               `json:"sense_gloss"`
	Senses     []entity.LexemeSense `json:"senses"`
}

// LexemeData represents data for a single lexeme
type LexemeData struct {
	LexemeID   string               `json:"lexeme_id"`
	POS        string               `json:"pos"`
	SenseGloss string               `json:"sense_gloss"`
	Senses     []entity.LexemeSense `json:"senses"`
}

// CleanWordSensesRequest represents a request to clean all lexemes of a word
type CleanWordSensesRequest struct {
	Word    string       `json:"word"`
	Lexemes []LexemeData `json:"lexemes"`
}

// CleanedLexemeData represents cleaned data for a single lexeme
type CleanedLexemeData struct {
	LexemeID   string               `json:"lexeme_id"`
	SenseGloss string               `json:"sense_gloss"`
	Senses     []entity.LexemeSense `json:"senses"`
}

// CleanWordSensesResponse represents the response from cleaning word senses
type CleanWordSensesResponse struct {
	Lexemes []CleanedLexemeData `json:"lexemes"`
}

type openaiAPIRequest struct {
	Model       string          `json:"model"`
	Messages    []openaiMessage `json:"messages"`
	MaxTokens   int             `json:"max_completion_tokens,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
}

type openaiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openaiAPIResponse struct {
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

func (c *ClaudeClient) CleanSenses(ctx context.Context, req CleanSensesRequest) (*CleanSensesResponse, error) {
	// Build prompt
	prompt := c.buildPrompt(req)

	// Create API request
	apiReq := openaiAPIRequest{
		Model:     openaiModel,
		MaxTokens: maxTokens,
		Messages: []openaiMessage{
			{
				Role:    "system",
				Content: "You are a lexicographic data cleaning assistant. Always respond with valid JSON only, no additional text.",
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
	}

	reqBody, err := json.Marshal(apiReq)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// Create HTTP request
	httpReq, err := http.NewRequestWithContext(ctx, "POST", openaiAPIURL, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	// Send request
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	// Parse response
	var apiResp openaiAPIResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if apiResp.Error != nil {
		return nil, fmt.Errorf("API error: %s - %s", apiResp.Error.Type, apiResp.Error.Message)
	}

	if len(apiResp.Choices) == 0 {
		return nil, fmt.Errorf("empty response choices")
	}

	// Extract JSON from response
	responseText := apiResp.Choices[0].Message.Content

	// Parse cleaned senses and gloss
	var response CleanSensesResponse
	if err := json.Unmarshal([]byte(responseText), &response); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w (response: %s)", err, responseText)
	}

	// Validate response
	if response.SenseGloss == "" {
		return nil, fmt.Errorf("missing sense_gloss in response")
	}
	if len(response.Senses) == 0 {
		return nil, fmt.Errorf("empty senses in response")
	}

	return &response, nil
}

func (c *ClaudeClient) buildPrompt(req CleanSensesRequest) string {
	sensesJSON, _ := json.MarshalIndent(req.Senses, "", "  ")

	currentGloss := "Not set"
	if req.SenseGloss != "" {
		currentGloss = req.SenseGloss
	}

	return fmt.Sprintf(`You are a lexicographic data cleaning assistant. Your task is to analyze and deduplicate word senses, and provide a concise one-line gloss.

Given:
- Word: %s
- Part of Speech: %s
- Lexeme ID: %s (IMPORTANT: This specific lexeme may be one of several lexemes for the same word)
- Current one-line gloss: %s
- Current senses (may contain duplicates or very similar meanings):

%s

Instructions:
1. **CRITICAL - Lexeme scope**:
   - You are ONLY processing senses for lexeme %s
   - The same word may have OTHER lexemes with DIFFERENT meanings (e.g., "bank" as financial institution vs. riverbank)
   - DO NOT add senses from other lexemes of the same word
   - ONLY work with the senses provided in the input for THIS specific lexeme
   - If completeness check identifies a truly missing common meaning, ensure it belongs to THIS lexeme's semantic domain
2. Remove grammatical form descriptions (e.g., "-ing form of", "past tense of", "p.p. of") - these are NOT senses
3. **CRITICAL - Language requirement**:
   - Output MUST include BOTH English (language: "en") and Chinese (language: "zh") senses
   - Remove all other languages (e.g., "zh-Hans", "fr", "es", etc.)
   - Each major sense meaning should have both an English and Chinese version
   - If input lacks English or Chinese, generate the missing language version
4. Analyze remaining senses and identify duplicates or near-duplicates
5. Merge similar senses, keeping the clearest and most concise definition
6. **Check for completeness (within THIS lexeme's scope)**:
   - Evaluate whether the input senses cover all common meanings for THIS specific lexeme
   - Only add meanings that clearly belong to this lexeme's semantic domain
   - DO NOT add meanings that likely belong to a different lexeme of the same word
   - Example: For lexeme L123 of "bank" (financial institution), DO NOT add "riverbank" meaning
7. For examples:
   - Preserve existing examples from merged senses
   - If a sense has fewer than 2 examples, generate natural, simple examples to reach 2 examples total
   - Examples should be short, clear, and demonstrate typical usage
7. Keep definitions brief and focused - avoid redundant explanations
8. Create a concise one-line gloss (sense_gloss):
   - **CRITICAL**: sense_gloss MUST be in English only
   - **Maximum 10 words** (strict limit)
   - Focus on the core meaning only
   - **CRITICAL**: Use vocabulary simpler than or equal to the target word's difficulty level
   - Avoid using advanced or technical words to describe basic words
   - For polysemous words, focus on the most common meaning

Output format requirements:
- Return a JSON object with two fields: "sense_gloss" and "senses"
- sense_gloss: A string with the one-line concise definition
- senses: An array where each sense has "language", "gloss", and optionally "examples"
- Each example must have "text" and optionally "translation"
- Return ONLY the JSON object, no additional text or explanation
- The JSON must be valid and parseable

Example output format:
{
  "sense_gloss": "to move rapidly on foot",
  "senses": [
    {
      "language": "en",
      "gloss": "to move swiftly on foot, faster than walking",
      "examples": [
        {"text": "She runs every morning", "translation": ""}
      ]
    }
  ]
}

Now, clean the senses, create the sense_gloss, and return the JSON object:`, req.Lemma, req.POS, req.LexemeID, currentGloss, req.LexemeID, string(sensesJSON))
}

// CleanWordSenses processes all lexemes of a word at once
func (c *ClaudeClient) CleanWordSenses(ctx context.Context, req CleanWordSensesRequest) (*CleanWordSensesResponse, error) {
	// Build prompt for word-level cleaning
	prompt := c.buildWordPrompt(req)

	// Create API request
	apiReq := openaiAPIRequest{
		Model:     openaiModel,
		MaxTokens: maxTokens,
		Messages: []openaiMessage{
			{
				Role:    "system",
				Content: "You are a lexicographic data cleaning assistant. Always respond with valid JSON only, no additional text.",
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
	}

	reqBody, err := json.Marshal(apiReq)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// Create HTTP request
	httpReq, err := http.NewRequestWithContext(ctx, "POST", openaiAPIURL, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	// Send request
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	// Parse response
	var apiResp openaiAPIResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if apiResp.Error != nil {
		return nil, fmt.Errorf("API error: %s - %s", apiResp.Error.Type, apiResp.Error.Message)
	}

	if len(apiResp.Choices) == 0 {
		return nil, fmt.Errorf("empty response choices")
	}

	// Extract JSON from response
	responseText := apiResp.Choices[0].Message.Content

	// Parse cleaned lexemes
	var response CleanWordSensesResponse
	if err := json.Unmarshal([]byte(responseText), &response); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w (response: %s)", err, responseText)
	}

	// Validate response
	if len(response.Lexemes) == 0 {
		return nil, fmt.Errorf("empty lexemes in response")
	}

	return &response, nil
}

func (c *ClaudeClient) buildWordPrompt(req CleanWordSensesRequest) string {
	lexemesJSON, _ := json.MarshalIndent(req.Lexemes, "", "  ")

	return fmt.Sprintf(`You are a lexicographic data cleaning assistant. Your task is to analyze and clean senses for ALL lexemes of a word.

Given:
- Word: %s
- All lexemes for this word (each lexeme represents a distinct meaning/part of speech):

%s

Instructions:
1. **Process each lexeme separately** - each lexeme may represent different meanings/parts of speech
2. For each lexeme:
   - Remove grammatical form descriptions (e.g., "-ing form of", "past tense of", "p.p. of") - these are NOT senses
   - **CRITICAL - Language requirement**:
     * Output MUST include BOTH English (language: "en") and Chinese (language: "zh") senses
     * Remove all other languages (e.g., "zh-Hans", "fr", "es", etc.)
     * Each major sense meaning should have both an English and Chinese version
     * If input lacks English or Chinese, generate the missing language version
   - Deduplicate and merge similar senses within that lexeme
   - Preserve distinct meanings - don't merge senses that are clearly different
   - For examples:
     * Preserve existing examples from merged senses
     * If a sense has fewer than 2 examples, generate natural, simple examples to reach 2 examples total
     * Examples should be short, clear, and demonstrate typical usage
   - Create a concise one-line gloss (sense_gloss):
     * **CRITICAL**: sense_gloss MUST be in English only
     * **Maximum 10 words** (strict limit)
     * Focus on the core meaning only
     * **CRITICAL**: Use vocabulary simpler than or equal to the target word's difficulty level
     * Avoid using advanced or technical words to describe basic words
     * For polysemous words, focus on the most common meaning for that specific lexeme

3. **DO NOT** add new senses or move senses between lexemes
4. **DO NOT** merge senses across different lexemes - keep lexeme boundaries intact

Output format requirements:
- Return a JSON object with field "lexemes" (array)
- Each lexeme must have: "lexeme_id", "sense_gloss", and "senses"
- Each sense has "language", "gloss", and optionally "examples"
- Each example must have "text" and optionally "translation"
- Return ONLY the JSON object, no additional text or explanation
- The JSON must be valid and parseable

Example output format:
{
  "lexemes": [
    {
      "lexeme_id": "L12345",
      "sense_gloss": "to move rapidly on foot",
      "senses": [
        {
          "language": "en",
          "gloss": "to move swiftly on foot, faster than walking",
          "examples": [
            {"text": "She runs every morning", "translation": ""}
          ]
        },
        {
          "language": "zh",
          "gloss": "跑步；奔跑",
          "examples": [
            {"text": "她每天早上跑步", "translation": "She runs every morning"}
          ]
        }
      ]
    }
  ]
}

Now, clean the senses for all lexemes and return the JSON object:`, req.Word, string(lexemesJSON))
}

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
)

const (
	openaiAPIURL = "https://api.openai.com/v1/chat/completions"
	openaiModel  = "gpt-4o-mini"
	maxTokens    = 8192
)

type OpenAIClient struct {
	apiKey     string
	httpClient *http.Client
}

func NewOpenAIClient(apiKey string) *OpenAIClient {
	return &OpenAIClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
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
	Model          string                `json:"model"`
	Messages       []openaiMessage       `json:"messages"`
	MaxTokens      int                   `json:"max_completion_tokens,omitempty"`
	Temperature    float64               `json:"temperature,omitempty"`
	ResponseFormat *openaiResponseFormat `json:"response_format,omitempty"`
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

type openaiResponseFormat struct {
	Type string `json:"type"`
}

// CleanWordSenses processes all lexemes of a word at once
func (c *OpenAIClient) CleanWordSenses(ctx context.Context, req CleanWordSensesRequest) (*CleanWordSensesResponse, error) {
	req = normalizeCleanWordRequest(req)
	// Build prompt for word-level cleaning
	prompt := c.buildWordPrompt(req)

	// Create API request
	apiReq := openaiAPIRequest{
		Model:     openaiModel,
		MaxTokens: maxTokens,
		ResponseFormat: &openaiResponseFormat{
			Type: "json_object",
		},
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
		return nil, fmt.Errorf("empty response choices (raw: %s)", string(body))
	}

	// Extract JSON from response
	responseText := apiResp.Choices[0].Message.Content
	if responseText == "" {
		return nil, fmt.Errorf("empty response content (finish_reason: %s, raw: %s)",
			apiResp.Choices[0].FinishReason, string(body))
	}

	// Parse cleaned lexemes
	var response CleanWordSensesResponse
	if err := json.Unmarshal([]byte(responseText), &response); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w (response: %s, raw: %s)", err, responseText, string(body))
	}

	// Validate response
	if len(response.Lexemes) == 0 {
		return nil, fmt.Errorf("empty lexemes in response")
	}

	return &response, nil
}

func (c *OpenAIClient) buildWordPrompt(req CleanWordSensesRequest) string {
	lexemesJSON, _ := json.MarshalIndent(req.Lexemes, "", "  ")

	return fmt.Sprintf(`You are a lexicographic data cleaning assistant. Your task is to analyze and clean senses for ALL lexemes of a word.

Given:
- Word: %s
- All lexemes for this word (each lexeme represents a distinct meaning/part of speech):

%s

Instructions:
1. **Process each lexeme separately** - each lexeme may represent different meanings/parts of speech
2. For each lexeme:
   - Use the lexeme's part of speech and examples as the ground truth for sense selection
   - **POS constraint**: Each sense must match its lexeme's POS
     * If a sense clearly belongs to a different POS, move it to the lexeme with the correct POS for this word
     * If no suitable lexeme exists, discard the sense
     * If POS is unclear, rely on the examples to decide; if still unclear, discard the sense
   - If examples show a fixed phrase/idiom/multiword expression (e.g., "leg it"), treat it as a separate sense and do NOT mix it into the base lemma meaning
     * The gloss must explicitly reflect the phrase/idiom meaning, not a generic base-lemma gloss
   - **CRITICAL - Language requirement**:
     * Output MUST include BOTH English (language: "en") and Chinese (language: "zh") senses
     * Each major sense meaning should have exactly one English and one Chinese version
     * Keep bilingual pairs adjacent and aligned (English sense followed by its Chinese counterpart)
     * If input lacks English or Chinese, generate the missing language version
     * **Chinese gloss rule**:
       - Prefer a direct Chinese word/term if one exists
       - Keep it short and term-like (avoid full sentence definitions)
       - If no standard Chinese term exists, use a short, phrase-like gloss (not a full sentence)
       - Example: "airport" -> "机场" (not a long descriptive sentence)
   - Deduplicate and merge similar senses within that lexeme; avoid splitting into near-duplicates unless the usage is clearly distinct
   - If duplicate senses exist across lexemes with the same POS, keep only one and merge examples
   - Preserve distinct meanings - don't merge senses that are clearly different
   - For examples:
     * Preserve existing examples from merged senses
     * If a sense has fewer than 2 examples, generate natural, simple examples to reach 2 examples total
     * Examples should be short, clear, and demonstrate typical usage
     * Examples must match the gloss precisely (no idiom examples under a base-lemma gloss)
     * English sense: examples should be English and do NOT need translations
     * Chinese sense: examples should be English and MUST include Chinese translations
   - Create a concise one-line gloss (sense_gloss):
     * **CRITICAL**: sense_gloss MUST be in English only
     * **Maximum 10 words** (strict limit)
     * Focus on the core meaning only
     * **CRITICAL**: Use vocabulary simpler than or equal to the target word's difficulty level
     * Avoid using advanced or technical words to describe basic words
     * For polysemous words, focus on the most common meaning for that specific lexeme

3. **DO NOT** add new senses beyond what is present; you may reassign existing senses to the correct lexeme
4. **DO NOT** merge senses across different lexemes unless they are the same POS and clearly duplicates

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

var grammaticalGlossPatternsEn = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^-?ing form of `),
	regexp.MustCompile(`(?i)^past tense of `),
	regexp.MustCompile(`(?i)^past participle of `),
	regexp.MustCompile(`(?i)^past tense and past participle of `),
	regexp.MustCompile(`(?i)^present participle of `),
	regexp.MustCompile(`(?i)^third person singular of `),
	regexp.MustCompile(`(?i)^plural of `),
	regexp.MustCompile(`(?i)^comparative of `),
	regexp.MustCompile(`(?i)^superlative of `),
	regexp.MustCompile(`(?i)^imperative of `),
	regexp.MustCompile(`(?i)^subjunctive of `),
	regexp.MustCompile(`(?i)^gerund of `),
	regexp.MustCompile(`(?i)^short form of `),
	regexp.MustCompile(`(?i)^form of `),
}

var grammaticalGlossPatternsZh = []*regexp.Regexp{
	regexp.MustCompile(`的过去式$`),
	regexp.MustCompile(`的过去分词$`),
	regexp.MustCompile(`的现在分词$`),
	regexp.MustCompile(`的比较级$`),
	regexp.MustCompile(`的最高级$`),
	regexp.MustCompile(`的复数$`),
	regexp.MustCompile(`的第三人称单数$`),
	regexp.MustCompile(`的动名词$`),
	regexp.MustCompile(`的简写$`),
	regexp.MustCompile(`的缩写$`),
}

func normalizeCleanWordRequest(req CleanWordSensesRequest) CleanWordSensesRequest {
	for i := range req.Lexemes {
		req.Lexemes[i].SenseGloss = strings.TrimSpace(req.Lexemes[i].SenseGloss)
		req.Lexemes[i].Senses = normalizeSenses(req.Lexemes[i].Senses)
	}
	return req
}

func normalizeSenses(senses []entity.LexemeSense) []entity.LexemeSense {
	if len(senses) == 0 {
		return senses
	}

	seen := make(map[string]struct{})
	var cleaned []entity.LexemeSense

	for _, sense := range senses {
		sense.Language = entity.ParseLanguage(string(sense.Language))
		if sense.Language != entity.LanguageEnglish && sense.Language != entity.LanguageChinese {
			continue
		}

		sense.Gloss = strings.TrimSpace(sense.Gloss)
		if sense.Gloss == "" {
			continue
		}

		if isGrammaticalGloss(sense.Language, sense.Gloss) {
			continue
		}

		sense.Examples = normalizeExamples(sense.Examples)
		key := string(sense.Language) + "|" + strings.ToLower(sense.Gloss)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		cleaned = append(cleaned, sense)
	}

	return cleaned
}

func normalizeExamples(examples []entity.SenseExample) []entity.SenseExample {
	if len(examples) == 0 {
		return examples
	}

	seen := make(map[string]struct{})
	var cleaned []entity.SenseExample
	for _, ex := range examples {
		ex.Text = strings.TrimSpace(ex.Text)
		ex.Translation = strings.TrimSpace(ex.Translation)
		if ex.Text == "" {
			continue
		}
		key := strings.ToLower(ex.Text) + "|" + strings.ToLower(ex.Translation)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		cleaned = append(cleaned, ex)
	}
	return cleaned
}

func isGrammaticalGloss(lang entity.Language, gloss string) bool {
	switch lang {
	case entity.LanguageEnglish:
		for _, re := range grammaticalGlossPatternsEn {
			if re.MatchString(gloss) {
				return true
			}
		}
	case entity.LanguageChinese:
		for _, re := range grammaticalGlossPatternsZh {
			if re.MatchString(gloss) {
				return true
			}
		}
	}
	return false
}

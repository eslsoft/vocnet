package wikidata

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
)

const (
	wikidataAPIBase     = "https://www.wikidata.org/w/api.php"
	wikidataRestBase    = "https://www.wikidata.org/wiki/Special:EntityData"
	wikidataLexemeQuery = "https://query.wikidata.org/sparql"
)

// Client implements WikidataProvider using the Wikidata REST API.
type Client struct {
	http    *http.Client
	timeout time.Duration
}

// NewClient creates a new Wikidata API client.
func NewClient() *Client {
	return &Client{
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
		timeout: 30 * time.Second,
	}
}

// SearchEntity searches Wikidata for a QID matching the given term.
func (c *Client) SearchEntity(ctx context.Context, term string, language string) (*provider.WikidataEntity, error) {
	params := url.Values{
		"action":   {"wbsearchentities"},
		"search":   {term},
		"language": {language},
		"format":   {"json"},
		"type":     {"item"},
		"limit":    {"5"},
	}

	reqURL := wikidataAPIBase + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "VocNet/1.0 (https://github.com/eslsoft/vocnet)")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wikidata search: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wikidata search returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var result struct {
		Search []struct {
			ID          string `json:"id"`
			Label       string `json:"label"`
			Description string `json:"description"`
		} `json:"search"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if len(result.Search) == 0 {
		return nil, nil
	}

	// Return the first match
	first := result.Search[0]
	return &provider.WikidataEntity{
		QID:         first.ID,
		Label:       first.Label,
		Description: first.Description,
	}, nil
}

// FetchLexemes fetches Wikidata lexemes for a given term using SPARQL.
// Returns the lexemes and the raw API response for evidence storage.
func (c *Client) FetchLexemes(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
	langCode := language
	if langCode == "" {
		langCode = "en"
	}

	// SPARQL query to find lexemes by lemma text
	sparql := fmt.Sprintf(`
SELECT ?lexeme ?lexemeLabel ?pos WHERE {
  ?lexeme dct:language wd:%s ;
          wikibase:lemma ?lexemeLabel ;
          wikibase:lexicalCategory ?pos .
  FILTER(LCASE(STR(?lexemeLabel)) = "%s")
}
LIMIT 10`, langQID(langCode), strings.ToLower(term))

	params := url.Values{
		"query":  {sparql},
		"format": {"json"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wikidataLexemeQuery+"?"+params.Encode(), nil)
	if err != nil {
		return nil, nil, fmt.Errorf("create sparql request: %w", err)
	}
	req.Header.Set("User-Agent", "VocNet/1.0 (https://github.com/eslsoft/vocnet)")
	req.Header.Set("Accept", "application/sparql-results+json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("wikidata sparql: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("wikidata sparql returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read sparql response: %w", err)
	}

	// Parse raw response for evidence storage
	var rawResponse map[string]any
	if err := json.Unmarshal(body, &rawResponse); err != nil {
		return nil, nil, fmt.Errorf("parse raw response: %w", err)
	}

	var sparqlResult struct {
		Results struct {
			Bindings []struct {
				Lexeme struct {
					Value string `json:"value"`
				} `json:"lexeme"`
				LexemeLabel struct {
					Value string `json:"value"`
				} `json:"lexemeLabel"`
				Pos struct {
					Value string `json:"value"`
				} `json:"pos"`
			} `json:"bindings"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &sparqlResult); err != nil {
		return nil, rawResponse, fmt.Errorf("parse sparql: %w", err)
	}

	lexemes := make([]provider.WikidataLexeme, 0, len(sparqlResult.Results.Bindings))
	for _, binding := range sparqlResult.Results.Bindings {
		lexemeID := extractID(binding.Lexeme.Value)
		posQID := extractID(binding.Pos.Value)

		lex := provider.WikidataLexeme{
			LexemeID: lexemeID,
			Language: langCode,
			POS:      mapWikidataPOS(posQID),
		}

		// Fetch detailed lexeme data (senses and forms)
		senses, forms, err := c.fetchLexemeDetail(ctx, lexemeID)
		if err == nil {
			lex.Senses = senses
			lex.Forms = forms
		}

		lexemes = append(lexemes, lex)
	}

	return lexemes, rawResponse, nil
}

// fetchLexemeDetail fetches senses and forms for a specific lexeme.
func (c *Client) fetchLexemeDetail(ctx context.Context, lexemeID string) ([]provider.WikidataSense, []provider.WikidataForm, error) {
	reqURL := fmt.Sprintf("%s/%s.json", wikidataRestBase, lexemeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", "VocNet/1.0 (https://github.com/eslsoft/vocnet)")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("fetch lexeme %s: status %d", lexemeID, resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}

	var data struct {
		Entities map[string]struct {
			Senses []struct {
				ID     string `json:"id"`
				Glosses map[string]struct {
					Value string `json:"value"`
				} `json:"glosses"`
			} `json:"senses"`
			Forms []struct {
				ID              string `json:"id"`
				Representations map[string]struct {
					Value string `json:"value"`
				} `json:"representations"`
				GrammaticalFeatures []string `json:"grammaticalFeatures"`
				Claims              struct {
					P898 []struct { // P898 is IPA transcription
						Mainsnak struct {
							Datavalue struct {
								Value string `json:"value"`
							} `json:"datavalue"`
						} `json:"mainsnak"`
						Qualifiers struct {
							P5237 []struct { // P5237 is pronunciation variant (US/UK/etc)
								Datavalue struct {
									Value struct {
										ID string `json:"id"`
									} `json:"value"`
								} `json:"datavalue"`
							} `json:"P5237"`
						} `json:"qualifiers"`
					} `json:"P898"`
				} `json:"claims"`
			} `json:"forms"`
		} `json:"entities"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, nil, fmt.Errorf("parse lexeme detail: %w", err)
	}

	entity, ok := data.Entities[lexemeID]
	if !ok {
		return nil, nil, nil
	}

	senses := make([]provider.WikidataSense, 0, len(entity.Senses))
	for _, s := range entity.Senses {
		glosses := make(map[string]string)
		for lang, g := range s.Glosses {
			glosses[lang] = g.Value
		}
		senses = append(senses, provider.WikidataSense{
			SenseID: s.ID,
			Glosses: glosses,
		})
	}

	forms := make([]provider.WikidataForm, 0, len(entity.Forms))
	for _, f := range entity.Forms {
		repr := ""
		for _, r := range f.Representations {
			repr = r.Value
			break
		}

		// Extract phonetics from P898 claims
		phonetics := make([]provider.WikidataPhonetic, 0)
		for _, p898 := range f.Claims.P898 {
			ipa := p898.Mainsnak.Datavalue.Value
			if ipa == "" {
				continue
			}

			// Extract dialect from P5237 qualifier (pronunciation variant)
			dialect := ""
			if len(p898.Qualifiers.P5237) > 0 {
				variantQID := p898.Qualifiers.P5237[0].Datavalue.Value.ID
				dialect = mapLanguageVariant(variantQID)
			}

			phonetics = append(phonetics, provider.WikidataPhonetic{
				IPA:     ipa,
				Dialect: dialect,
			})
		}

		forms = append(forms, provider.WikidataForm{
			FormID:         f.ID,
			Representation: repr,
			Features:       f.GrammaticalFeatures,
			Phonetics:      phonetics,
		})
	}

	return senses, forms, nil
}

// extractID extracts the Wikidata ID from a full URI.
func extractID(uri string) string {
	parts := strings.Split(uri, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return uri
}

// langQID returns the Wikidata QID for a language code.
func langQID(code string) string {
	switch code {
	case "en":
		return "Q1860"
	case "zh":
		return "Q7850"
	case "es":
		return "Q1321"
	case "fr":
		return "Q150"
	case "de":
		return "Q188"
	case "ja":
		return "Q5287"
	case "ko":
		return "Q9176"
	default:
		return "Q1860" // English
	}
}

// mapWikidataPOS converts a Wikidata POS QID to a standard POS string.
func mapWikidataPOS(qid string) string {
	switch qid {
	case "Q1084":
		return "noun"
	case "Q24905":
		return "verb"
	case "Q34698":
		return "adjective"
	case "Q380057":
		return "adverb"
	case "Q36224":
		return "pronoun"
	case "Q4833830":
		return "preposition"
	case "Q36484":
		return "conjunction"
	case "Q83034":
		return "interjection"
	default:
		return qid
	}
}


// mapLanguageVariant converts a Wikidata language variant QID to BCP 47 dialect tag.
func mapLanguageVariant(qid string) string {
	switch qid {
	case "Q7976": // American English
		return "en-US"
	case "Q7979": // British English
		return "en-GB"
	case "Q100163": // Australian English
		return "en-AU"
	case "Q44679": // Canadian English
		return "en-CA"
	default:
		return "" // Unknown dialect
	}
}

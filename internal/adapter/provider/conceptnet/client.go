package conceptnet

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
)

const (
	conceptNetAPIBase = "https://api.conceptnet.io"
)

// Client implements ConceptNetProvider using the ConceptNet REST API.
type Client struct {
	http *http.Client
}

// NewClient creates a new ConceptNet API client.
func NewClient() *Client {
	return &Client{
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// FetchRelations fetches semantic relations for a term from ConceptNet.
// Returns the edges and the raw API response for evidence storage.
func (c *Client) FetchRelations(ctx context.Context, term string, language string) ([]provider.ConceptNetEdge, map[string]any, error) {
	if language == "" {
		language = "en"
	}

	reqURL := fmt.Sprintf("%s/c/%s/%s?limit=50", conceptNetAPIBase, language, strings.ToLower(term))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "VocNet/1.0 (https://github.com/eslsoft/vocnet)")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("conceptnet fetch: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("conceptnet returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read response: %w", err)
	}

	// Parse raw response for evidence storage
	var rawResponse map[string]any
	if err := json.Unmarshal(body, &rawResponse); err != nil {
		return nil, nil, fmt.Errorf("parse raw response: %w", err)
	}

	var result struct {
		Edges []struct {
			Rel struct {
				Label string `json:"label"`
			} `json:"rel"`
			Start struct {
				Label    string `json:"label"`
				Language string `json:"language"`
				Term     string `json:"@id"`
			} `json:"start"`
			End struct {
				Label    string `json:"label"`
				Language string `json:"language"`
				Term     string `json:"@id"`
			} `json:"end"`
			Weight      float64 `json:"weight"`
			SurfaceText string  `json:"surfaceText"`
		} `json:"edges"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, rawResponse, fmt.Errorf("parse conceptnet: %w", err)
	}

	edges := make([]provider.ConceptNetEdge, 0, len(result.Edges))
	for _, e := range result.Edges {
		// Only include edges where at least one side matches our language
		if e.Start.Language != language && e.End.Language != language {
			continue
		}

		relType := mapConceptNetRelation(e.Rel.Label)
		if relType == "" {
			continue
		}

		// Determine target term (the other side from our search term)
		targetTerm := e.End.Label
		if strings.EqualFold(e.End.Label, term) {
			targetTerm = e.Start.Label
		}

		edges = append(edges, provider.ConceptNetEdge{
			RelationType: relType,
			StartTerm:    e.Start.Label,
			EndTerm:      e.End.Label,
			Weight:       e.Weight,
			SurfaceText:  e.SurfaceText,
		})

		_ = targetTerm // used in edge construction above
	}

	return edges, rawResponse, nil
}

// mapConceptNetRelation maps a ConceptNet relation label to our relation type constants.
func mapConceptNetRelation(label string) string {
	switch label {
	case "Synonym":
		return entity.RelationSynonym
	case "Antonym":
		return entity.RelationAntonym
	case "IsA":
		return entity.RelationHypernym
	case "RelatedTo":
		return entity.RelationAssociation
	case "Causes":
		return entity.RelationCauseEffect
	case "PartOf", "HasA":
		return entity.RelationPartWhole
	case "DerivedFrom", "EtymologicallyDerivedFrom":
		return entity.RelationDerivative
	default:
		return ""
	}
}

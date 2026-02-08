package conceptnet

import (
	"bufio"
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"strings"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
)

// Reader implements ConceptNetProvider using local CSV data file.
// ConceptNet assertions format: /c/en/term	/r/RelatedTo	/c/en/target	...
type Reader struct {
	dataPath string
}

// NewReader creates a new ConceptNet local data reader.
func NewReader(dataPath string) (*Reader, error) {
	if dataPath == "" {
		return nil, fmt.Errorf("conceptnet data path is required")
	}
	if _, err := os.Stat(dataPath); err != nil {
		return nil, fmt.Errorf("conceptnet data file not found: %w", err)
	}
	return &Reader{
		dataPath: dataPath,
	}, nil
}

// FetchRelations reads semantic relations for a term from local ConceptNet CSV file.
// Returns the edges and a summary map for evidence storage.
func (r *Reader) FetchRelations(ctx context.Context, term string, language string) ([]provider.ConceptNetEdge, map[string]any, error) {
	if language == "" {
		language = "en"
	}

	file, err := os.Open(r.dataPath)
	if err != nil {
		return nil, nil, fmt.Errorf("open conceptnet file: %w", err)
	}
	defer func() { _ = file.Close() }()

	// Build the search pattern: /c/<lang>/<term>
	searchTerm := fmt.Sprintf("/c/%s/%s", language, strings.ToLower(term))

	edges := make([]provider.ConceptNetEdge, 0)
	scanner := bufio.NewScanner(file)
	// Increase buffer size for large lines
	buf := make([]byte, 1024*1024) // 1MB buffer
	scanner.Buffer(buf, 1024*1024)

	lineCount := 0
	matchCount := 0

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		default:
		}

		lineCount++
		line := scanner.Text()

		// Quick check if line contains our term
		if !strings.Contains(line, searchTerm) {
			continue
		}

		// Parse CSV fields (tab-separated)
		reader := csv.NewReader(strings.NewReader(line))
		reader.Comma = '\t'
		reader.LazyQuotes = true

		fields, err := reader.Read()
		if err != nil {
			// Skip malformed lines
			continue
		}

		// ConceptNet 5.7 CSV format (tab-separated):
		// 0: assertion_uri (e.g., /a/[/r/RelatedTo/,/c/en/hello/,/c/en/greeting/])
		// 1: relation_uri (/r/RelatedTo)
		// 2: start (/c/en/hello)
		// 3: end (/c/en/greeting)
		// 4: metadata JSON (contains weight)
		if len(fields) < 5 {
			continue
		}

		// assertionURI := fields[0] // Not used
		relationURI := fields[1]
		startURI := fields[2]
		endURI := fields[3]
		metadataJSON := fields[4]

		// Extract weight from metadata JSON
		weight := extractWeight(metadataJSON)

		// Check if either start or end matches our search term
		if startURI != searchTerm && endURI != searchTerm {
			continue
		}

		// Extract relation type from URI (/r/Synonym → Synonym)
		relLabel := extractRelationLabel(relationURI)
		relType := mapConceptNetRelation(relLabel)
		if relType == "" {
			continue
		}

		// Extract term labels
		startLabel := extractTermLabel(startURI)
		endLabel := extractTermLabel(endURI)
		if startLabel == "" || endLabel == "" {
			continue
		}

		edges = append(edges, provider.ConceptNetEdge{
			RelationType: relType,
			StartTerm:    startLabel,
			EndTerm:      endLabel,
			Weight:       weight,
			SurfaceText:  fmt.Sprintf("%s %s %s", startLabel, relLabel, endLabel),
		})

		matchCount++
		// Limit to 100 relations per term
		if matchCount >= 100 {
			break
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, nil, fmt.Errorf("scan conceptnet file: %w", err)
	}

	// Create evidence summary
	evidence := map[string]any{
		"source":        "conceptnet-local",
		"term":          term,
		"language":      language,
		"edges_found":   len(edges),
		"lines_scanned": lineCount,
	}

	return edges, evidence, nil
}

// extractRelationLabel extracts label from relation URI
// /r/Synonym → Synonym
func extractRelationLabel(uri string) string {
	parts := strings.Split(uri, "/")
	if len(parts) >= 3 && parts[1] == "r" {
		return parts[2]
	}
	return ""
}

// extractTermLabel extracts term from concept URI
// /c/en/hello → hello
func extractTermLabel(uri string) string {
	parts := strings.Split(uri, "/")
	if len(parts) >= 4 && parts[1] == "c" {
		// Join remaining parts in case term contains slashes
		return strings.Join(parts[3:], "/")
	}
	return ""
}

// parseFloat parses a float string, returns 1.0 on error
func parseFloat(s string) float64 {
	var f float64
	if _, err := fmt.Sscanf(s, "%f", &f); err != nil {
		return 1.0
	}
	return f
}

// extractWeight extracts weight from ConceptNet metadata JSON
func extractWeight(jsonStr string) float64 {
	// Simple extraction without full JSON parsing for performance
	// Look for "weight": 1.0 pattern
	weightIdx := strings.Index(jsonStr, `"weight":`)
	if weightIdx == -1 {
		return 1.0
	}

	// Skip to the number part
	start := weightIdx + len(`"weight":`)
	end := start
	for end < len(jsonStr) && (jsonStr[end] == ' ' || jsonStr[end] == '\t') {
		end++
	}
	start = end

	// Read until non-numeric character
	for end < len(jsonStr) {
		c := jsonStr[end]
		if (c >= '0' && c <= '9') || c == '.' || c == '-' || c == 'e' || c == 'E' {
			end++
		} else {
			break
		}
	}

	if start < end {
		return parseFloat(jsonStr[start:end])
	}
	return 1.0
}

// Note: mapConceptNetRelation is defined in client.go

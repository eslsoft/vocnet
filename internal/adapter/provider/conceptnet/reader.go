package conceptnet

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"strings"

	_ "modernc.org/sqlite"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
)

// Reader implements ConceptNetProvider using a SQLite index.
// The index must be built by the datasource layer before using this reader.
type Reader struct {
	db      *sql.DB
	csvPath string
}

// NewReader creates a new ConceptNet local data reader.
// It expects the SQLite index to already exist (built by datasource layer).
func NewReader(dataPath string) (*Reader, error) {
	return NewReaderWithLogger(dataPath, nil)
}

// NewReaderWithLogger creates a new ConceptNet reader with optional logger for diagnostics.
func NewReaderWithLogger(dataPath string, logger *slog.Logger) (*Reader, error) {
	if dataPath == "" {
		return nil, fmt.Errorf("conceptnet data path is required")
	}
	if _, err := os.Stat(dataPath); err != nil {
		return nil, fmt.Errorf("conceptnet data file not found: %w", err)
	}

	dbPath := dataPath + ".idx.db"
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("conceptnet index not found (run 'vocnet pipeline source download conceptnet' first): %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open conceptnet index: %w", err)
	}

	// Set read-only mode via PRAGMA (modernc.org/sqlite doesn't support DSN params)
	if _, err := db.Exec("PRAGMA query_only = ON"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set read-only mode: %w", err)
	}

	// SQLite is a single-file database; limit the pool to avoid extra file handles and locking issues.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping conceptnet index: %w", err)
	}

	return &Reader{db: db, csvPath: dataPath}, nil
}

// Close closes the database connection.
func (r *Reader) Close() error {
	if r.db != nil {
		return r.db.Close()
	}
	return nil
}

// FetchRelations queries the SQLite index for semantic relations of a term.
func (r *Reader) FetchRelations(ctx context.Context, term string, language string) ([]provider.ConceptNetEdge, map[string]any, error) {
	if language == "" {
		language = "en"
	}

	searchTerm := fmt.Sprintf("/c/%s/%s", language, strings.ToLower(term))

	query := `
		SELECT relation, start_uri, end_uri, weight
		FROM edges
		WHERE start_uri = ? OR end_uri = ?
		LIMIT 100
	`

	rows, err := r.db.QueryContext(ctx, query, searchTerm, searchTerm)
	if err != nil {
		return nil, nil, fmt.Errorf("query conceptnet index: %w", err)
	}
	defer func() { _ = rows.Close() }()

	edges := make([]provider.ConceptNetEdge, 0)
	for rows.Next() {
		var relation, startURI, endURI string
		var weight float64
		if err := rows.Scan(&relation, &startURI, &endURI, &weight); err != nil {
			return nil, nil, fmt.Errorf("scan conceptnet row: %w", err)
		}

		relLabel := extractRelationLabel(relation)
		relType := mapConceptNetRelation(relLabel)
		if relType == "" {
			continue
		}

		startLang, startLabel := extractTermInfo(startURI)
		endLang, endLabel := extractTermInfo(endURI)
		if startLabel == "" || endLabel == "" {
			continue
		}
		// Skip cross-language edges: both endpoints must be in the query language.
		if startLang != language || endLang != language {
			continue
		}

		edges = append(edges, provider.ConceptNetEdge{
			RelationType:  relType,
			StartTerm:     startLabel,
			StartLanguage: startLang,
			EndTerm:       endLabel,
			EndLanguage:   endLang,
			Weight:        weight,
			SurfaceText:   fmt.Sprintf("%s %s %s", startLabel, relLabel, endLabel),
		})
	}

	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate conceptnet rows: %w", err)
	}

	evidence := map[string]any{
		"source":      "conceptnet-indexed",
		"term":        term,
		"language":    language,
		"edges_found": len(edges),
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

// extractTermInfo extracts the language code and term from a ConceptNet concept URI.
// URI format: /c/{lang}/{term}[/{pos}[/{sense}...]]
// Examples:
//
//	/c/en/hello         → ("en", "hello")
//	/c/en/run/v         → ("en", "run")
//	/c/en/bank/n/wn/bank_1 → ("en", "bank")
//	/c/zh/跑/v          → ("zh", "跑")
func extractTermInfo(uri string) (lang, term string) {
	parts := strings.Split(uri, "/")
	// parts[0]="" parts[1]="c" parts[2]=lang parts[3]=term [parts[4]=pos ...]
	if len(parts) >= 4 && parts[1] == "c" {
		return parts[2], parts[3]
	}
	return "", ""
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

package conceptnet

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
)

// Reader implements ConceptNetProvider using a SQLite index built from the CSV.
// On first use, the CSV is scanned once to build a SQLite database for fast lookups.
type Reader struct {
	db      *sql.DB
	csvPath string
}

// NewReader creates a new ConceptNet local data reader.
// It builds a SQLite index from the CSV if one doesn't already exist.
func NewReader(dataPath string) (*Reader, error) {
	return NewReaderWithLogger(dataPath, nil)
}

// NewReaderWithLogger creates a new ConceptNet reader with optional logger for index build progress.
func NewReaderWithLogger(dataPath string, logger *slog.Logger) (*Reader, error) {
	if dataPath == "" {
		return nil, fmt.Errorf("conceptnet data path is required")
	}
	if _, err := os.Stat(dataPath); err != nil {
		return nil, fmt.Errorf("conceptnet data file not found: %w", err)
	}

	dbPath := dataPath + ".idx.db"

	// Build index if needed
	if err := ensureIndex(dataPath, dbPath, logger); err != nil {
		return nil, fmt.Errorf("build conceptnet index: %w", err)
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

// ensureIndex checks if the SQLite index exists and is valid; if not, builds it from the CSV.
func ensureIndex(csvPath, dbPath string, logger *slog.Logger) error {
	// Check if index already exists and is newer than the CSV
	csvInfo, err := os.Stat(csvPath)
	if err != nil {
		return fmt.Errorf("stat csv: %w", err)
	}

	if dbInfo, err := os.Stat(dbPath); err == nil {
		if dbInfo.ModTime().After(csvInfo.ModTime()) && dbInfo.Size() > 0 {
			// Index exists and is newer than CSV — validate it
			if validateIndex(dbPath) == nil {
				return nil
			}
		}
		// Index is stale or invalid — buildIndex writes to a temp file and
		// atomically renames it over dbPath, so we don't delete the old index
		// here (active readers may still be using it).
	}

	return buildIndex(csvPath, dbPath, logger)
}

// validateIndex checks that the SQLite index is structurally valid.
func validateIndex(dbPath string) error {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	var dummy int
	err = db.QueryRow("SELECT 1 FROM edges LIMIT 1").Scan(&dummy)
	if err == sql.ErrNoRows {
		return fmt.Errorf("empty index")
	}
	return err
}

// buildIndex scans the ConceptNet CSV and builds a SQLite index.
func buildIndex(csvPath, dbPath string, logger *slog.Logger) error {
	if logger != nil {
		logger.Info("building ConceptNet SQLite index (one-time operation)", "csv", csvPath, "db", dbPath)
	}

	// Build to a temp file, rename on success to avoid partial indices
	tmpFile, err := os.CreateTemp(filepath.Dir(dbPath), "conceptnet-idx-*.db.tmp")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	_ = tmpFile.Close()
	defer func() { _ = os.Remove(tmpPath) }()

	db, err := sql.Open("sqlite", tmpPath)
	if err != nil {
		return fmt.Errorf("create index db: %w", err)
	}

	// Performance pragmas for bulk insert
	for _, pragma := range []string{
		"PRAGMA journal_mode=OFF",
		"PRAGMA synchronous=OFF",
		"PRAGMA cache_size=-262144", // 256MB cache
		"PRAGMA temp_store=MEMORY",
	} {
		if _, err := db.Exec(pragma); err != nil {
			_ = db.Close()
			return fmt.Errorf("set pragma: %w", err)
		}
	}

	// Create table without indices (add after bulk insert)
	_, err = db.Exec(`
		CREATE TABLE edges (
			start_uri TEXT NOT NULL,
			end_uri   TEXT NOT NULL,
			relation  TEXT NOT NULL,
			weight    REAL NOT NULL DEFAULT 1.0
		)
	`)
	if err != nil {
		_ = db.Close()
		return fmt.Errorf("create table: %w", err)
	}

	// Open CSV
	file, err := os.Open(csvPath)
	if err != nil {
		_ = db.Close()
		return fmt.Errorf("open csv: %w", err)
	}
	defer func() { _ = file.Close() }()

	tx, err := db.Begin()
	if err != nil {
		_ = db.Close()
		return fmt.Errorf("begin tx: %w", err)
	}

	stmt, err := tx.Prepare("INSERT INTO edges (start_uri, end_uri, relation, weight) VALUES (?, ?, ?, ?)")
	if err != nil {
		_ = tx.Rollback()
		_ = db.Close()
		return fmt.Errorf("prepare insert: %w", err)
	}

	scanner := bufio.NewScanner(file)
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 1024*1024)

	lineCount := 0
	insertCount := 0

	for scanner.Scan() {
		lineCount++

		line := scanner.Text()

		// Parse tab-separated fields (avoid csv.Reader for performance on ~34M lines)
		fields := strings.SplitN(line, "\t", 6)
		if len(fields) < 5 {
			continue
		}

		relationURI := fields[1]
		startURI := fields[2]
		endURI := fields[3]
		metadataJSON := fields[4]

		// Only index relations we actually care about
		relLabel := extractRelationLabel(relationURI)
		if mapConceptNetRelation(relLabel) == "" {
			continue
		}

		weight := extractWeight(metadataJSON)

		if _, err := stmt.Exec(startURI, endURI, relationURI, weight); err != nil {
			_ = tx.Rollback()
			_ = db.Close()
			return fmt.Errorf("insert edge (%s, %s, %s): %w", startURI, endURI, relationURI, err)
		}
		insertCount++

		// Log progress periodically
		if logger != nil && lineCount%5_000_000 == 0 {
			logger.Info("indexing ConceptNet", "lines_scanned", lineCount, "edges_indexed", insertCount)
		}
	}

	if err := scanner.Err(); err != nil {
		_ = tx.Rollback()
		_ = db.Close()
		return fmt.Errorf("scan csv: %w", err)
	}

	_ = stmt.Close()

	if err := tx.Commit(); err != nil {
		_ = db.Close()
		return fmt.Errorf("commit: %w", err)
	}

	if logger != nil {
		logger.Info("creating indices", "edges_indexed", insertCount)
	}

	// Create indices after bulk insert (much faster than during)
	for _, ddl := range []string{
		"CREATE INDEX idx_edges_start ON edges(start_uri)",
		"CREATE INDEX idx_edges_end ON edges(end_uri)",
	} {
		if _, err := db.Exec(ddl); err != nil {
			_ = db.Close()
			return fmt.Errorf("create index: %w", err)
		}
	}

	_ = db.Close()

	// Replace any existing index file with the newly built one in a
	// cross-platform way. On Windows, os.Rename fails if the target
	// already exists, so remove it first (ignoring "not exists").
	if err := os.Remove(dbPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove existing index: %w", err)
	}
	if err := os.Rename(tmpPath, dbPath); err != nil {
		return fmt.Errorf("rename index: %w", err)
	}

	if logger != nil {
		logger.Info("ConceptNet index built",
			"lines_scanned", lineCount,
			"edges_indexed", insertCount,
		)
	}

	return nil
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

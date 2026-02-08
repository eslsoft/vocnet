package datasource

import (
	"bufio"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// ConceptNetIndexer builds a SQLite index from the ConceptNet CSV file.
type ConceptNetIndexer struct {
	csvPath string
	dbPath  string
	logger  *slog.Logger
}

// NewConceptNetIndexer creates a new ConceptNet indexer.
func NewConceptNetIndexer(csvPath string, logger *slog.Logger) *ConceptNetIndexer {
	return &ConceptNetIndexer{
		csvPath: csvPath,
		dbPath:  csvPath + ".idx.db",
		logger:  logger,
	}
}

// DBPath returns the path to the SQLite index database.
func (idx *ConceptNetIndexer) DBPath() string {
	return idx.dbPath
}

// NeedsIndex returns true if the index needs to be built or rebuilt.
func (idx *ConceptNetIndexer) NeedsIndex() bool {
	csvInfo, err := os.Stat(idx.csvPath)
	if err != nil {
		return true
	}

	dbInfo, err := os.Stat(idx.dbPath)
	if err != nil {
		return true
	}

	// Check if index is newer than source and valid
	if dbInfo.ModTime().After(csvInfo.ModTime()) && dbInfo.Size() > 0 {
		if idx.validateIndex() == nil {
			return false
		}
	}

	return true
}

// validateIndex checks that the SQLite index is structurally valid.
func (idx *ConceptNetIndexer) validateIndex() error {
	db, err := sql.Open("sqlite", idx.dbPath)
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

// BuildIndex scans the ConceptNet CSV and builds a SQLite index.
func (idx *ConceptNetIndexer) BuildIndex() error {
	if idx.logger != nil {
		idx.logger.Info("building ConceptNet SQLite index", "csv", idx.csvPath, "db", idx.dbPath)
	}

	// Build to a temp file, rename on success to avoid partial indices
	tmpFile, err := os.CreateTemp(filepath.Dir(idx.dbPath), "conceptnet-idx-*.db.tmp")
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
	file, err := os.Open(idx.csvPath)
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
		relLabel := extractConceptNetRelationLabel(relationURI)
		if mapConceptNetRelation(relLabel) == "" {
			continue
		}

		weight := extractConceptNetWeight(metadataJSON)

		if _, err := stmt.Exec(startURI, endURI, relationURI, weight); err != nil {
			_ = tx.Rollback()
			_ = db.Close()
			return fmt.Errorf("insert edge (%s, %s, %s): %w", startURI, endURI, relationURI, err)
		}
		insertCount++

		// Log progress periodically
		if idx.logger != nil && lineCount%5_000_000 == 0 {
			idx.logger.Info("indexing ConceptNet", "lines_scanned", lineCount, "edges_indexed", insertCount)
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

	if idx.logger != nil {
		idx.logger.Info("creating indices", "edges_indexed", insertCount)
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
	if err := os.Remove(idx.dbPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove existing index: %w", err)
	}
	if err := os.Rename(tmpPath, idx.dbPath); err != nil {
		return fmt.Errorf("rename index: %w", err)
	}

	if idx.logger != nil {
		idx.logger.Info("ConceptNet index built",
			"lines_scanned", lineCount,
			"edges_indexed", insertCount,
		)
	}

	return nil
}

// extractConceptNetRelationLabel extracts label from relation URI
// /r/Synonym → Synonym
func extractConceptNetRelationLabel(uri string) string {
	parts := strings.Split(uri, "/")
	if len(parts) >= 3 && parts[1] == "r" {
		return parts[2]
	}
	return ""
}

// extractConceptNetWeight extracts weight from ConceptNet metadata JSON
func extractConceptNetWeight(jsonStr string) float64 {
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
		var f float64
		if _, err := fmt.Sscanf(jsonStr[start:end], "%f", &f); err == nil {
			return f
		}
	}
	return 1.0
}

// mapConceptNetRelation maps ConceptNet relation labels to standardized types.
func mapConceptNetRelation(relation string) string {
	switch relation {
	case "Synonym":
		return "synonym"
	case "Antonym":
		return "antonym"
	case "RelatedTo":
		return "related"
	case "FormOf":
		return "form_of"
	case "DerivedFrom":
		return "derived_from"
	case "EtymologicallyRelatedTo":
		return "etymologically_related"
	case "IsA":
		return "is_a"
	case "PartOf":
		return "part_of"
	case "HasA":
		return "has_a"
	case "UsedFor":
		return "used_for"
	case "CapableOf":
		return "capable_of"
	case "AtLocation":
		return "at_location"
	case "Causes":
		return "causes"
	case "HasProperty":
		return "has_property"
	case "SimilarTo":
		return "similar_to"
	case "MannerOf":
		return "manner_of"
	default:
		return ""
	}
}

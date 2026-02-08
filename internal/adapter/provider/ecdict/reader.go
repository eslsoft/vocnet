package ecdict

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

// ECDICTEntry represents a dictionary entry from ECDICT.
type ECDICTEntry struct {
	Word         string   // word
	Phonetic     string   // phonetic transcription
	Definition   string   // English definition
	Translation  string   // Chinese translation
	POS          string   // part of speech
	Tags         []string // tags (e.g., "zk", "gk")
	BNC          int      // British National Corpus frequency
	Frq          int      // frequency rank
	Collins      int      // Collins dictionary level
	Oxford       bool     // Oxford 3000 word
	ExchangeData string   // word forms (e.g., "p:ran/d:run/i:running")
}

// Reader provides access to local ECDICT SQLite database.
type Reader struct {
	db *sql.DB
}

// NewReader creates a new ECDICT database reader.
func NewReader(dbPath string) (*Reader, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("ecdict database path is required")
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open ecdict database: %w", err)
	}

	// Set read-only mode via PRAGMA
	if _, err := db.Exec("PRAGMA query_only = ON"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set read-only mode: %w", err)
	}

	// SQLite is a single-file database; limit the pool
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	// Verify database is accessible
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping ecdict database: %w", err)
	}

	return &Reader{db: db}, nil
}

// Close closes the database connection.
func (r *Reader) Close() error {
	return r.db.Close()
}

// Lookup fetches a word entry from ECDICT.
func (r *Reader) Lookup(ctx context.Context, word string) (*ECDICTEntry, error) {
	query := `
		SELECT
			word,
			COALESCE(phonetic, ''),
			COALESCE(definition, ''),
			COALESCE(translation, ''),
			COALESCE(pos, ''),
			COALESCE(tag, ''),
			COALESCE(bnc, 0),
			COALESCE(frq, 0),
			COALESCE(collins, 0),
			COALESCE(oxford, 0),
			COALESCE(exchange, '')
		FROM stardict
		WHERE word = ? COLLATE NOCASE
		LIMIT 1
	`

	var entry ECDICTEntry
	var tag string
	var oxford int

	err := r.db.QueryRowContext(ctx, query, strings.ToLower(word)).Scan(
		&entry.Word,
		&entry.Phonetic,
		&entry.Definition,
		&entry.Translation,
		&entry.POS,
		&tag,
		&entry.BNC,
		&entry.Frq,
		&entry.Collins,
		&oxford,
		&entry.ExchangeData,
	)

	if err == sql.ErrNoRows {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("query ecdict: %w", err)
	}

	// Parse tags
	if tag != "" {
		entry.Tags = strings.Fields(tag)
	}
	entry.Oxford = oxford > 0

	return &entry, nil
}

// ParseWordForms parses the exchange field to extract word forms.
// Format: "p:ran/d:run/i:running/3:runs/s:runs"
// Keys: p=past, d=done (past participle), i=ing, 3=third person, s=plural
func ParseWordForms(exchange string) map[string][]string {
	forms := make(map[string][]string)
	if exchange == "" {
		return forms
	}

	pairs := strings.Split(exchange, "/")
	for _, pair := range pairs {
		parts := strings.SplitN(pair, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := parts[0]
		values := strings.Split(parts[1], " ")
		forms[key] = values
	}

	return forms
}

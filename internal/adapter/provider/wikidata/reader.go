package wikidata

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	_ "modernc.org/sqlite"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
)

// Reader implements WikidataProvider using a local SQLite index.
// The index must be built by the datasource layer before using this reader.
type Reader struct {
	db       *sql.DB
	jsonPath string
	logger   *slog.Logger
}

// NewReader creates a new Wikidata local data reader.
// It expects the SQLite index to already exist (built by datasource layer).
func NewReader(dataPath string) (*Reader, error) {
	return NewReaderWithLogger(dataPath, nil)
}

// NewReaderWithLogger creates a new Wikidata reader with optional logger.
func NewReaderWithLogger(dataPath string, logger *slog.Logger) (*Reader, error) {
	if dataPath == "" {
		return nil, fmt.Errorf("wikidata data path is required")
	}
	if _, err := os.Stat(dataPath); err != nil {
		return nil, fmt.Errorf("wikidata data file not found: %w", err)
	}

	dbPath := dataPath + ".idx.db"
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("wikidata index not found (run 'vocnet pipeline source download wikidata' first): %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open wikidata index: %w", err)
	}

	// Set read-only mode via PRAGMA
	if _, err := db.Exec("PRAGMA query_only = ON"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set read-only mode: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping wikidata index: %w", err)
	}

	return &Reader{db: db, jsonPath: dataPath, logger: logger}, nil
}

// Close closes the database connection.
func (r *Reader) Close() error {
	if r.db != nil {
		return r.db.Close()
	}
	return nil
}

// SearchEntity searches for a Wikidata entity by term.
// Note: This returns nil for local reader as entity search requires API.
// The local dump only contains lexemes, not general entities.
func (r *Reader) SearchEntity(ctx context.Context, term string, language string) (*provider.WikidataEntity, error) {
	// Local dump doesn't contain entity search capability
	// Return nil to indicate no entity found (caller can fall back to API if needed)
	return nil, nil
}

// FetchLexemes fetches Wikidata lexemes for a given term from the local index.
func (r *Reader) FetchLexemes(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
	if language == "" {
		language = "en"
	}

	termLower := strings.ToLower(term)

	// Query lexemes by lemma
	query := `
		SELECT id, lemma, language, pos, data
		FROM lexemes
		WHERE lemma_lower = ? AND language = ?
		LIMIT 10
	`

	rows, err := r.db.QueryContext(ctx, query, termLower, language)
	if err != nil {
		return nil, nil, fmt.Errorf("query wikidata index: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var lexemes []provider.WikidataLexeme
	var rawDataList []map[string]any

	for rows.Next() {
		var id, lemma, lang, pos, data string
		if err := rows.Scan(&id, &lemma, &lang, &pos, &data); err != nil {
			return nil, nil, fmt.Errorf("scan wikidata row: %w", err)
		}

		// Convert to provider.WikidataLexeme
		wl := provider.WikidataLexeme{
			LexemeID: id,
			Language: lang,
			POS:      pos,
		}

		// Fetch senses
		senses, err := r.fetchSenses(ctx, id)
		if err == nil {
			wl.Senses = senses
		}

		// Fetch forms
		forms, err := r.fetchForms(ctx, id)
		if err == nil {
			wl.Forms = forms
		}

		lexemes = append(lexemes, wl)

		// Store raw data for evidence
		var rawData map[string]any
		_ = json.Unmarshal([]byte(data), &rawData)
		rawDataList = append(rawDataList, rawData)
	}

	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate wikidata rows: %w", err)
	}

	evidence := map[string]any{
		"source":        "wikidata-indexed",
		"term":          term,
		"language":      language,
		"lexemes_found": len(lexemes),
		"raw_data":      rawDataList,
	}

	return lexemes, evidence, nil
}

// fetchSenses fetches senses for a lexeme.
func (r *Reader) fetchSenses(ctx context.Context, lexemeID string) ([]provider.WikidataSense, error) {
	query := `
		SELECT id, gloss_en, gloss_zh
		FROM senses
		WHERE lexeme_id = ?
	`

	rows, err := r.db.QueryContext(ctx, query, lexemeID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var senses []provider.WikidataSense
	for rows.Next() {
		var id string
		var glossEn, glossZh sql.NullString
		if err := rows.Scan(&id, &glossEn, &glossZh); err != nil {
			continue
		}

		glosses := make(map[string]string)
		if glossEn.Valid && glossEn.String != "" {
			glosses["en"] = glossEn.String
		}
		if glossZh.Valid && glossZh.String != "" {
			glosses["zh"] = glossZh.String
		}

		senses = append(senses, provider.WikidataSense{
			SenseID: id,
			Glosses: glosses,
		})
	}

	return senses, nil
}

// fetchForms fetches forms for a lexeme.
func (r *Reader) fetchForms(ctx context.Context, lexemeID string) ([]provider.WikidataForm, error) {
	query := `
		SELECT id, representation, features, ipa
		FROM forms
		WHERE lexeme_id = ?
	`

	rows, err := r.db.QueryContext(ctx, query, lexemeID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var forms []provider.WikidataForm
	for rows.Next() {
		var id, repr string
		var features, ipa sql.NullString
		if err := rows.Scan(&id, &repr, &features, &ipa); err != nil {
			continue
		}

		form := provider.WikidataForm{
			FormID:         id,
			Representation: repr,
		}

		// Parse features
		if features.Valid && features.String != "" {
			var featureList []string
			if err := json.Unmarshal([]byte(features.String), &featureList); err == nil {
				form.Features = featureList
			}
		}

		// Add phonetics if IPA is available
		if ipa.Valid && ipa.String != "" {
			form.Phonetics = []provider.WikidataPhonetic{
				{IPA: ipa.String},
			}
		}

		forms = append(forms, form)
	}

	return forms, nil
}

// FetchLexemesByForm searches for lexemes by an inflected form.
func (r *Reader) FetchLexemesByForm(ctx context.Context, form string, language string) ([]provider.WikidataLexeme, error) {
	if language == "" {
		language = "en"
	}

	formLower := strings.ToLower(form)

	// Find lexeme IDs that have this form
	query := `
		SELECT DISTINCT l.id, l.lemma, l.language, l.pos, l.data
		FROM forms f
		JOIN lexemes l ON f.lexeme_id = l.id
		WHERE f.representation_lower = ? AND l.language = ?
		LIMIT 10
	`

	rows, err := r.db.QueryContext(ctx, query, formLower, language)
	if err != nil {
		return nil, fmt.Errorf("query forms: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var lexemes []provider.WikidataLexeme
	for rows.Next() {
		var id, lemma, lang, pos, data string
		if err := rows.Scan(&id, &lemma, &lang, &pos, &data); err != nil {
			continue
		}

		wl := provider.WikidataLexeme{
			LexemeID: id,
			Language: lang,
			POS:      pos,
		}

		senses, _ := r.fetchSenses(ctx, id)
		wl.Senses = senses

		forms, _ := r.fetchForms(ctx, id)
		wl.Forms = forms

		lexemes = append(lexemes, wl)
	}

	return lexemes, nil
}

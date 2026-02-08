package wikidata

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"sort"
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
	termLower := strings.ToLower(strings.TrimSpace(term))
	searchKey := normalizeSearchKey(term)
	orthKey := orthographyKey(term)

	query := `
		SELECT l.id, l.lemma, l.language, l.pos, l.data,
			CASE
				WHEN l.lemma_lower = ? THEN 'exact_lemma'
				WHEN f.representation_lower = ? THEN 'exact_form'
				WHEN l.lemma_key = ? THEN 'normalized_lemma'
				WHEN f.representation_key = ? THEN 'normalized_form'
				WHEN l.lemma_orth_key = ? THEN 'orth_lemma'
				WHEN f.representation_orth_key = ? THEN 'orth_form'
				ELSE 'none'
			END AS match_level,
			CASE
				WHEN l.lemma_lower = ? THEN 100
				WHEN f.representation_lower = ? THEN 90
				WHEN l.lemma_key = ? THEN 70
				WHEN f.representation_key = ? THEN 60
				WHEN l.lemma_orth_key = ? THEN 50
				WHEN f.representation_orth_key = ? THEN 40
				ELSE 0
			END AS match_score
		FROM lexemes l
		LEFT JOIN forms f ON f.lexeme_id = l.id
		WHERE l.language = ?
		  AND (
				l.lemma_lower = ?
				OR l.lemma_key = ?
				OR l.lemma_orth_key = ?
				OR f.representation_lower = ?
				OR f.representation_key = ?
				OR f.representation_orth_key = ?
		  )
		LIMIT 10
	`
	rows, err := r.db.QueryContext(
		ctx,
		query,
		termLower, termLower, searchKey, searchKey, orthKey, orthKey,
		termLower, termLower, searchKey, searchKey, orthKey, orthKey,
		language,
		termLower, searchKey, orthKey, termLower, searchKey, orthKey,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("query wikidata index: %w", err)
	}
	defer func() { _ = rows.Close() }()

	type rankedLexemeRow struct {
		lexemeRow
		matchLevel string
		matchScore int
	}

	bestByID := map[string]rankedLexemeRow{}
	rawByID := map[string]map[string]any{}
	for rows.Next() {
		var row rankedLexemeRow
		if err := rows.Scan(&row.id, &row.lemma, &row.lang, &row.pos, &row.data, &row.matchLevel, &row.matchScore); err != nil {
			return nil, nil, fmt.Errorf("scan wikidata row: %w", err)
		}
		if row.matchScore <= 0 {
			continue
		}
		prev, ok := bestByID[row.id]
		if !ok || row.matchScore > prev.matchScore {
			bestByID[row.id] = row
		}
		if _, ok := rawByID[row.id]; !ok {
			var rawData map[string]any
			_ = json.Unmarshal([]byte(row.data), &rawData)
			rawByID[row.id] = rawData
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate wikidata rows: %w", err)
	}

	rankedRows := make([]rankedLexemeRow, 0, len(bestByID))
	for _, row := range bestByID {
		rankedRows = append(rankedRows, row)
	}
	sort.Slice(rankedRows, func(i, j int) bool {
		if rankedRows[i].matchScore != rankedRows[j].matchScore {
			return rankedRows[i].matchScore > rankedRows[j].matchScore
		}
		return rankedRows[i].id < rankedRows[j].id
	})

	parsedRows := make([]lexemeRow, 0, len(rankedRows))
	rawData := make([]map[string]any, 0, len(rankedRows))
	candidates := make([]map[string]any, 0, len(rankedRows))
	for i, row := range rankedRows {
		parsedRows = append(parsedRows, row.lexemeRow)
		if raw := rawByID[row.id]; raw != nil {
			rawData = append(rawData, raw)
		}
		if i < 5 {
			candidates = append(candidates, map[string]any{
				"lexeme_id":   row.id,
				"lemma":       row.lemma,
				"match_level": row.matchLevel,
				"match_score": row.matchScore,
			})
		}
	}
	lexemes := r.buildLexemesWithDetails(ctx, parsedRows)

	topLevel := ""
	topScore := 0
	if len(rankedRows) > 0 {
		topLevel = rankedRows[0].matchLevel
		topScore = rankedRows[0].matchScore
	}

	evidence := map[string]any{
		"source":          "wikidata-indexed",
		"term":            term,
		"language":        language,
		"query_key":       searchKey,
		"orth_key":        orthKey,
		"match_level":     topLevel,
		"match_score":     topScore,
		"candidate_count": len(rankedRows),
		"candidates":      candidates,
		"lexemes_found":   len(lexemes),
		"raw_data":        rawData,
	}

	return lexemes, evidence, nil
}

type lexemeRow struct {
	id    string
	lemma string
	lang  string
	pos   string
	data  string
}

func (r *Reader) fetchLexemesByFormWithRaw(ctx context.Context, form string, language string) ([]provider.WikidataLexeme, []map[string]any, error) {
	// Find lexeme IDs that have this form
	query := `
		SELECT DISTINCT l.id, l.lemma, l.language, l.pos, l.data
		FROM forms f
		JOIN lexemes l ON f.lexeme_id = l.id
		WHERE f.representation_lower = ? AND l.language = ?
		LIMIT 10
	`

	rows, err := r.db.QueryContext(ctx, query, strings.ToLower(form), language)
	if err != nil {
		return nil, nil, fmt.Errorf("query forms: %w", err)
	}
	defer func() { _ = rows.Close() }()

	parsedRows, rawDataList, err := scanLexemeRows(rows)
	if err != nil {
		return nil, nil, err
	}

	lexemes := r.buildLexemesWithDetails(ctx, parsedRows)
	return lexemes, rawDataList, nil
}

func scanLexemeRows(rows *sql.Rows) ([]lexemeRow, []map[string]any, error) {
	// Read all rows first, then perform follow-up queries (senses/forms).
	// This avoids deadlock when MaxOpenConns=1 and the driver serializes queries.
	var parsedRows []lexemeRow
	var rawDataList []map[string]any

	for rows.Next() {
		var row lexemeRow
		if err := rows.Scan(&row.id, &row.lemma, &row.lang, &row.pos, &row.data); err != nil {
			return nil, nil, fmt.Errorf("scan wikidata row: %w", err)
		}
		parsedRows = append(parsedRows, row)

		// Store raw data for evidence
		var rawData map[string]any
		_ = json.Unmarshal([]byte(row.data), &rawData)
		rawDataList = append(rawDataList, rawData)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate wikidata rows: %w", err)
	}

	return parsedRows, rawDataList, nil
}

func (r *Reader) buildLexemesWithDetails(ctx context.Context, parsedRows []lexemeRow) []provider.WikidataLexeme {
	lexemes := make([]provider.WikidataLexeme, 0, len(parsedRows))
	for _, row := range parsedRows {
		wl := provider.WikidataLexeme{
			LexemeID: row.id,
			Language: row.lang,
			POS:      row.pos,
		}
		senses, err := r.fetchSenses(ctx, row.id)
		if err == nil {
			wl.Senses = senses
		}
		forms, err := r.fetchForms(ctx, row.id)
		if err == nil {
			wl.Forms = forms
		}
		lexemes = append(lexemes, wl)
	}
	return lexemes
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
	lexemes, _, err := r.fetchLexemesByFormWithRaw(ctx, form, language)
	return lexemes, err
}

func normalizeSearchKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return s
	}
	replacer := strings.NewReplacer(
		"’", "",
		"‘", "",
		"ʼ", "",
		".", "",
		"'", "",
		"-", "",
		"_", "",
		" ", "",
	)
	return replacer.Replace(s)
}

func orthographyKey(s string) string {
	key := normalizeSearchKey(s)
	if key == "" {
		return key
	}
	key = strings.ReplaceAll(key, "our", "or")
	key = strings.ReplaceAll(key, "ise", "ize")
	key = strings.ReplaceAll(key, "yse", "yze")
	if strings.HasSuffix(key, "re") && len(key) > 4 {
		key = strings.TrimSuffix(key, "re") + "er"
	}
	if strings.HasSuffix(key, "ice") && len(key) > 4 {
		key = strings.TrimSuffix(key, "ice") + "ize"
	}
	return key
}

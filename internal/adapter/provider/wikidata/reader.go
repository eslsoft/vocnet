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

	// Open in read-only immutable mode — tells SQLite the file will NEVER change,
	// allowing it to skip all locking entirely. This dramatically improves
	// concurrent read performance since there's no lock contention at all.
	dsn := "file:" + dbPath + "?mode=ro&immutable=1"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open wikidata index: %w", err)
	}

	// No connection limit: read-only SQLite supports unlimited concurrent readers.
	// Each reader holds only a SHARED lock which never conflicts with other readers.
	// This eliminates connection-pool contention as the bottleneck under high concurrency.
	db.SetMaxOpenConns(0)
	db.SetMaxIdleConns(10)

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

// FetchLexemes fetches Wikidata lexemes for a given term from the local index.
func (r *Reader) FetchLexemes(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
	if language == "" {
		language = "en"
	}
	termLower := strings.ToLower(strings.TrimSpace(term))
	searchKey := normalizeSearchKey(term)
	orthKey := orthographyKey(term)

	// Use UNION instead of OR to allow SQLite to use indexes efficiently.
	// Each sub-query can use its specific index, then results are merged.
	query := `
		SELECT id, lemma, language, pos, data, match_level, match_score FROM (
			SELECT l.id, l.lemma, l.language, l.pos, l.data, 'exact_lemma' as match_level, 100 as match_score
			FROM lexemes l WHERE l.language = ? AND l.lemma_lower = ?
			UNION ALL
			SELECT l.id, l.lemma, l.language, l.pos, l.data, 'normalized_lemma' as match_level, 70 as match_score
			FROM lexemes l WHERE l.language = ? AND l.lemma_key = ?
			UNION ALL
			SELECT l.id, l.lemma, l.language, l.pos, l.data, 'orth_lemma' as match_level, 50 as match_score
			FROM lexemes l WHERE l.language = ? AND l.lemma_orth_key = ?
			UNION ALL
			SELECT l.id, l.lemma, l.language, l.pos, l.data, 'exact_form' as match_level, 90 as match_score
			FROM forms f JOIN lexemes l ON f.lexeme_id = l.id WHERE l.language = ? AND f.representation_lower = ?
			UNION ALL
			SELECT l.id, l.lemma, l.language, l.pos, l.data, 'normalized_form' as match_level, 60 as match_score
			FROM forms f JOIN lexemes l ON f.lexeme_id = l.id WHERE l.language = ? AND f.representation_key = ?
			UNION ALL
			SELECT l.id, l.lemma, l.language, l.pos, l.data, 'orth_form' as match_level, 40 as match_score
			FROM forms f JOIN lexemes l ON f.lexeme_id = l.id WHERE l.language = ? AND f.representation_orth_key = ?
		)
		ORDER BY match_score DESC
		LIMIT 10
	`
	rows, err := r.db.QueryContext(
		ctx,
		query,
		language, termLower,
		language, searchKey,
		language, orthKey,
		language, termLower,
		language, searchKey,
		language, orthKey,
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
	if len(parsedRows) == 0 {
		return nil
	}

	// Collect all lexeme IDs for batch query
	lexemeIDs := make([]string, len(parsedRows))
	for i, row := range parsedRows {
		lexemeIDs[i] = row.id
	}

	// Batch fetch all senses and forms in 2 queries instead of 2*N queries
	sensesMap := r.batchFetchSenses(ctx, lexemeIDs)
	formsMap := r.batchFetchForms(ctx, lexemeIDs)

	// Build lexemes using pre-fetched data
	lexemes := make([]provider.WikidataLexeme, 0, len(parsedRows))
	for _, row := range parsedRows {
		wl := provider.WikidataLexeme{
			LexemeID: row.id,
			Language: row.lang,
			POS:      row.pos,
			Senses:   sensesMap[row.id],
			Forms:    formsMap[row.id],
		}
		lexemes = append(lexemes, wl)
	}
	return lexemes
}

// batchFetchSenses fetches senses for multiple lexemes in a single query.
func (r *Reader) batchFetchSenses(ctx context.Context, lexemeIDs []string) map[string][]provider.WikidataSense {
	if len(lexemeIDs) == 0 {
		return nil
	}

	// Build placeholder string: ?,?,?...
	placeholders := make([]string, len(lexemeIDs))
	args := make([]any, len(lexemeIDs))
	for i, id := range lexemeIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT lexeme_id, id, gloss_en, gloss_zh
		FROM senses
		WHERE lexeme_id IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string][]provider.WikidataSense)
	for rows.Next() {
		var lexemeID, id string
		var glossEn, glossZh sql.NullString
		if err := rows.Scan(&lexemeID, &id, &glossEn, &glossZh); err != nil {
			continue
		}

		glosses := make(map[string]string)
		if glossEn.Valid && glossEn.String != "" {
			glosses["en"] = glossEn.String
		}
		if glossZh.Valid && glossZh.String != "" {
			glosses["zh"] = glossZh.String
		}

		result[lexemeID] = append(result[lexemeID], provider.WikidataSense{
			SenseID: id,
			Glosses: glosses,
		})
	}

	return result
}

// batchFetchForms fetches forms for multiple lexemes in a single query.
func (r *Reader) batchFetchForms(ctx context.Context, lexemeIDs []string) map[string][]provider.WikidataForm {
	if len(lexemeIDs) == 0 {
		return nil
	}

	// Build placeholder string: ?,?,?...
	placeholders := make([]string, len(lexemeIDs))
	args := make([]any, len(lexemeIDs))
	for i, id := range lexemeIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT lexeme_id, id, representation, features, ipa
		FROM forms
		WHERE lexeme_id IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string][]provider.WikidataForm)
	for rows.Next() {
		var lexemeID, id, repr string
		var features, ipa sql.NullString
		if err := rows.Scan(&lexemeID, &id, &repr, &features, &ipa); err != nil {
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

		result[lexemeID] = append(result[lexemeID], form)
	}

	return result
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

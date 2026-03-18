package wikidata

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// WikidataIndexer builds a SQLite index from the Wikidata lexemes JSON dump.
type WikidataIndexer struct {
	jsonPath string
	dbPath   string
	logger   *slog.Logger
}

// NewWikidataIndexer creates a new Wikidata indexer.
func NewWikidataIndexer(jsonPath string, logger *slog.Logger) *WikidataIndexer {
	return &WikidataIndexer{
		jsonPath: jsonPath,
		dbPath:   jsonPath + ".idx.db",
		logger:   logger,
	}
}

// DBPath returns the path to the SQLite index database.
func (idx *WikidataIndexer) DBPath() string {
	return idx.dbPath
}

// NeedsIndex returns true if the index needs to be built or rebuilt.
func (idx *WikidataIndexer) NeedsIndex() bool {
	jsonInfo, err := os.Stat(idx.jsonPath)
	if err != nil {
		return true
	}

	dbInfo, err := os.Stat(idx.dbPath)
	if err != nil {
		return true
	}

	// Check if index is newer than source and valid
	if dbInfo.ModTime().After(jsonInfo.ModTime()) && dbInfo.Size() > 0 {
		if idx.validateIndex() == nil {
			return false
		}
	}

	return true
}

// validateIndex checks that the SQLite index is structurally valid.
func (idx *WikidataIndexer) validateIndex() error {
	db, err := sql.Open("sqlite", idx.dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	var dummy int
	err = db.QueryRow("SELECT 1 FROM lexemes LIMIT 1").Scan(&dummy)
	if err == sql.ErrNoRows {
		return fmt.Errorf("empty index")
	}
	return err
}

// BuildIndex scans the Wikidata JSON dump and builds a SQLite index.
func (idx *WikidataIndexer) BuildIndex() error {
	if idx.logger != nil {
		idx.logger.Info("building Wikidata SQLite index", "json", idx.jsonPath, "db", idx.dbPath)
	}

	// Build to a temp file, rename on success
	tmpFile, err := os.CreateTemp(filepath.Dir(idx.dbPath), "wikidata-idx-*.db.tmp")
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

	// Create tables
	if err := idx.createTables(db); err != nil {
		_ = db.Close()
		return err
	}

	// Open JSON file
	file, err := os.Open(idx.jsonPath)
	if err != nil {
		_ = db.Close()
		return fmt.Errorf("open json: %w", err)
	}
	defer func() { _ = file.Close() }()

	// Parse and insert
	if err := idx.parseAndInsert(db, file); err != nil {
		_ = db.Close()
		return err
	}

	// Create indices after bulk insert
	if err := idx.createIndices(db); err != nil {
		_ = db.Close()
		return err
	}

	_ = db.Close()

	// Atomic rename
	if err := os.Remove(idx.dbPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove existing index: %w", err)
	}
	if err := os.Rename(tmpPath, idx.dbPath); err != nil {
		return fmt.Errorf("rename index: %w", err)
	}

	if idx.logger != nil {
		idx.logger.Info("Wikidata index built", "db", idx.dbPath)
	}

	return nil
}

func (idx *WikidataIndexer) createTables(db *sql.DB) error {
	ddl := `
		CREATE TABLE lexemes (
			id TEXT PRIMARY KEY,
			lemma TEXT NOT NULL,
			lemma_lower TEXT NOT NULL,
			lemma_key TEXT NOT NULL,
			lemma_variants TEXT NOT NULL DEFAULT '',
			language TEXT NOT NULL,
			pos TEXT NOT NULL,
			data TEXT NOT NULL
		);

		CREATE TABLE lemma_variant_lookup (
			lexeme_id TEXT NOT NULL,
			variant_lower TEXT NOT NULL
		);

		CREATE TABLE forms (
			id TEXT PRIMARY KEY,
			lexeme_id TEXT NOT NULL,
			representation TEXT NOT NULL,
			representation_lower TEXT NOT NULL,
			representation_key TEXT NOT NULL,
			features TEXT,
			ipa TEXT
		);

		CREATE TABLE senses (
			id TEXT PRIMARY KEY,
			lexeme_id TEXT NOT NULL,
			gloss_en TEXT,
			gloss_zh TEXT
		);
	`
	_, err := db.Exec(ddl)
	if err != nil {
		return fmt.Errorf("create tables: %w", err)
	}
	return nil
}

func (idx *WikidataIndexer) createIndices(db *sql.DB) error {
	if idx.logger != nil {
		idx.logger.Info("creating indices")
	}

	indices := []string{
		"CREATE INDEX idx_lexemes_lemma_lang ON lexemes(lemma_lower, language)",
		"CREATE INDEX idx_lexemes_lemma_key_lang ON lexemes(lemma_key, language)",
		"CREATE INDEX idx_variant_lookup ON lemma_variant_lookup(variant_lower, lexeme_id)",
		"CREATE INDEX idx_lexemes_language ON lexemes(language)",
		"CREATE INDEX idx_forms_lexeme ON forms(lexeme_id)",
		"CREATE INDEX idx_forms_repr ON forms(representation_lower)",
		"CREATE INDEX idx_forms_repr_key ON forms(representation_key)",
		"CREATE INDEX idx_senses_lexeme ON senses(lexeme_id)",
	}

	for _, ddl := range indices {
		if _, err := db.Exec(ddl); err != nil {
			return fmt.Errorf("create index: %w", err)
		}
	}

	return nil
}

// wikidataLexemeJSON represents the JSON structure of a Wikidata lexeme.
type wikidataLexemeJSON struct {
	Type            string                        `json:"type"`
	ID              string                        `json:"id"`
	Lemmas          map[string]wikidataLemmaValue `json:"lemmas"`
	LexicalCategory string                        `json:"lexicalCategory"`
	Language        string                        `json:"language"`
	Senses          []wikidataSenseJSON           `json:"senses"`
	Forms           []wikidataFormJSON            `json:"forms"`
}

type wikidataLemmaValue struct {
	Language string `json:"language"`
	Value    string `json:"value"`
}

type wikidataSenseJSON struct {
	ID      string                        `json:"id"`
	Glosses map[string]wikidataGlossValue `json:"glosses"`
}

type wikidataGlossValue struct {
	Language string `json:"language"`
	Value    string `json:"value"`
}

type wikidataFormJSON struct {
	ID                  string                         `json:"id"`
	Representations     map[string]wikidataLemmaValue  `json:"representations"`
	GrammaticalFeatures []string                       `json:"grammaticalFeatures"`
	Claims              map[string][]wikidataClaimJSON `json:"claims"`
}

type wikidataClaimJSON struct {
	Mainsnak struct {
		Datavalue struct {
			Value any `json:"value"`
		} `json:"datavalue"`
	} `json:"mainsnak"`
}

// wikidataInserter holds prepared statements for batch inserts.
type wikidataInserter struct {
	tx          *sql.Tx
	lexemeStmt  *sql.Stmt
	variantStmt *sql.Stmt
	formStmt    *sql.Stmt
	senseStmt   *sql.Stmt
}

func newWikidataInserter(db *sql.DB) (*wikidataInserter, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}

	ins := &wikidataInserter{tx: tx}
	if err := ins.prepareStatements(); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return ins, nil
}

func (ins *wikidataInserter) prepareStatements() error {
	var err error
	ins.lexemeStmt, err = ins.tx.Prepare("INSERT INTO lexemes (id, lemma, lemma_lower, lemma_key, lemma_variants, language, pos, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return fmt.Errorf("prepare lexeme insert: %w", err)
	}

	ins.variantStmt, err = ins.tx.Prepare("INSERT INTO lemma_variant_lookup (lexeme_id, variant_lower) VALUES (?, ?)")
	if err != nil {
		return fmt.Errorf("prepare variant insert: %w", err)
	}

	ins.formStmt, err = ins.tx.Prepare("INSERT INTO forms (id, lexeme_id, representation, representation_lower, representation_key, features, ipa) VALUES (?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return fmt.Errorf("prepare form insert: %w", err)
	}

	ins.senseStmt, err = ins.tx.Prepare("INSERT INTO senses (id, lexeme_id, gloss_en, gloss_zh) VALUES (?, ?, ?, ?)")
	if err != nil {
		return fmt.Errorf("prepare sense insert: %w", err)
	}
	return nil
}

func (ins *wikidataInserter) close() {
	if ins.lexemeStmt != nil {
		_ = ins.lexemeStmt.Close()
	}
	if ins.variantStmt != nil {
		_ = ins.variantStmt.Close()
	}
	if ins.formStmt != nil {
		_ = ins.formStmt.Close()
	}
	if ins.senseStmt != nil {
		_ = ins.senseStmt.Close()
	}
}

func (ins *wikidataInserter) rollback() {
	ins.close()
	if ins.tx != nil {
		_ = ins.tx.Rollback()
	}
}

func (ins *wikidataInserter) commit() error {
	ins.close()
	if ins.tx != nil {
		return ins.tx.Commit()
	}
	return nil
}

func (ins *wikidataInserter) restart(db *sql.DB) error {
	if err := ins.commit(); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	ins.tx = tx
	return ins.prepareStatements()
}

func (idx *WikidataIndexer) parseAndInsert(db *sql.DB, file *os.File) error {
	ins, err := newWikidataInserter(db)
	if err != nil {
		return err
	}
	defer ins.rollback()

	scanner := bufio.NewScanner(file)
	buf := make([]byte, 10*1024*1024) // 10MB buffer for large lines
	scanner.Buffer(buf, 10*1024*1024)

	lineCount := 0
	lexemeCount := 0
	batchSize := 10000

	for scanner.Scan() {
		lineCount++
		line := strings.TrimSpace(scanner.Text())

		lexeme, ok := idx.parseLine(line)
		if !ok {
			continue
		}

		inserted, err := idx.insertLexeme(ins, lexeme)
		if err != nil {
			return err
		}
		if !inserted {
			continue
		}
		lexemeCount++

		if err := idx.insertVariants(ins, lexeme); err != nil {
			return err
		}

		if err := idx.insertForms(ins, lexeme); err != nil {
			return err
		}

		if err := idx.insertSenses(ins, lexeme); err != nil {
			return err
		}

		// Commit batch
		if lexemeCount%batchSize == 0 {
			if err := ins.restart(db); err != nil {
				return err
			}

			if idx.logger != nil && lexemeCount%100000 == 0 {
				idx.logger.Info("indexing Wikidata", "lines_scanned", lineCount, "lexemes_indexed", lexemeCount)
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scan json: %w", err)
	}

	if err := ins.commit(); err != nil {
		return fmt.Errorf("commit final: %w", err)
	}

	if idx.logger != nil {
		idx.logger.Info("Wikidata parsing completed", "lines_scanned", lineCount, "lexemes_indexed", lexemeCount)
	}

	return nil
}

func (idx *WikidataIndexer) parseLine(line string) (*wikidataLexemeJSON, bool) {
	// Skip array brackets and commas
	if line == "[" || line == "]" || line == "" {
		return nil, false
	}

	// Remove trailing comma
	line = strings.TrimSuffix(line, ",")

	var lexeme wikidataLexemeJSON
	if err := json.Unmarshal([]byte(line), &lexeme); err != nil {
		return nil, false
	}

	// Only process lexemes
	if lexeme.Type != "lexeme" {
		return nil, false
	}

	return &lexeme, true
}

func (idx *WikidataIndexer) insertLexeme(ins *wikidataInserter, lexeme *wikidataLexemeJSON) (bool, error) {
	// Get the primary lemma: prefer the shortest language code (e.g., "en" over "en-us")
	// to ensure British English is canonical (en < en-gb < en-us alphabetically and by length).
	var lemma, lemmaLang string
	for lang, l := range lexeme.Lemmas {
		if lemma == "" || len(lang) < len(lemmaLang) || (len(lang) == len(lemmaLang) && lang < lemmaLang) {
			lemma = l.Value
			lemmaLang = lang
		}
	}

	if lemma == "" {
		return false, nil
	}

	// Collect variant spellings (all lemma values except the primary)
	var variants []string
	primaryLower := strings.ToLower(lemma)
	for _, l := range lexeme.Lemmas {
		v := strings.TrimSpace(l.Value)
		if strings.ToLower(v) != primaryLower {
			variants = append(variants, v)
		}
	}
	variantsStr := strings.Join(variants, ",")

	// Map language QID to ISO code
	langCode := mapWikidataLanguageQID(lexeme.Language)
	if langCode == "" {
		langCode = lemmaLang
	}

	// Map POS QID to string
	pos := mapWikidataPOSQID(lexeme.LexicalCategory)

	// Store full JSON data for later retrieval
	data, _ := json.Marshal(lexeme)

	_, err := ins.lexemeStmt.Exec(
		lexeme.ID,
		lemma,
		strings.ToLower(lemma),
		normalizeSearchKey(lemma),
		variantsStr,
		langCode,
		pos,
		string(data),
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return false, nil
		}
		return false, fmt.Errorf("insert lexeme %s: %w", lexeme.ID, err)
	}
	return true, nil
}

func (idx *WikidataIndexer) insertVariants(ins *wikidataInserter, lexeme *wikidataLexemeJSON) error {
	// Get primary lemma (same logic as insertLexeme)
	var primaryLemma, primaryLang string
	for lang, l := range lexeme.Lemmas {
		if primaryLemma == "" || len(lang) < len(primaryLang) || (len(lang) == len(primaryLang) && lang < primaryLang) {
			primaryLemma = l.Value
			primaryLang = lang
		}
	}
	primaryLower := strings.ToLower(strings.TrimSpace(primaryLemma))

	for _, l := range lexeme.Lemmas {
		v := strings.ToLower(strings.TrimSpace(l.Value))
		if v == "" || v == primaryLower {
			continue
		}
		if _, err := ins.variantStmt.Exec(lexeme.ID, v); err != nil {
			return fmt.Errorf("insert variant for %s: %w", lexeme.ID, err)
		}
	}
	return nil
}

func (idx *WikidataIndexer) insertForms(ins *wikidataInserter, lexeme *wikidataLexemeJSON) error {
	for _, form := range lexeme.Forms {
		var repr string
		for _, r := range form.Representations {
			repr = r.Value
			break
		}
		if repr == "" {
			continue
		}

		features, _ := json.Marshal(form.GrammaticalFeatures)
		ipa := extractWikidataIPA(form.Claims)

		_, err := ins.formStmt.Exec(
			form.ID,
			lexeme.ID,
			repr,
			strings.ToLower(repr),
			normalizeSearchKey(repr),
			string(features),
			ipa,
		)
		if err != nil && !strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("insert form %s: %w", form.ID, err)
		}
	}
	return nil
}

func (idx *WikidataIndexer) insertSenses(ins *wikidataInserter, lexeme *wikidataLexemeJSON) error {
	for _, sense := range lexeme.Senses {
		glossEn, glossZh := extractWikidataGlosses(sense.Glosses)

		_, err := ins.senseStmt.Exec(sense.ID, lexeme.ID, glossEn, glossZh)
		if err != nil && !strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("insert sense %s: %w", sense.ID, err)
		}
	}
	return nil
}

func extractWikidataGlosses(glosses map[string]wikidataGlossValue) (string, string) {
	var glossEn, glossZh string
	if g, ok := glosses["en"]; ok {
		glossEn = g.Value
	}
	if g, ok := glosses["zh"]; ok {
		glossZh = g.Value
	}
	if glossZh == "" {
		if g, ok := glosses["zh-hans"]; ok {
			glossZh = g.Value
		}
	}
	if glossZh == "" {
		if g, ok := glosses["zh-hant"]; ok {
			glossZh = g.Value
		}
	}
	return glossEn, glossZh
}

// extractWikidataIPA extracts IPA pronunciation from form claims (P898).
func extractWikidataIPA(claims map[string][]wikidataClaimJSON) string {
	p898Claims, ok := claims["P898"]
	if !ok || len(p898Claims) == 0 {
		return ""
	}

	for _, claim := range p898Claims {
		if s, ok := claim.Mainsnak.Datavalue.Value.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// mapWikidataLanguageQID maps Wikidata language QID to ISO 639-1 code.
func mapWikidataLanguageQID(qid string) string {
	switch qid {
	case "Q1860":
		return "en"
	case "Q7850":
		return "zh"
	case "Q1321":
		return "es"
	case "Q150":
		return "fr"
	case "Q188":
		return "de"
	case "Q5287":
		return "ja"
	case "Q9176":
		return "ko"
	case "Q652":
		return "it"
	case "Q5146":
		return "pt"
	case "Q7737":
		return "ru"
	case "Q9288":
		return "he"
	case "Q13955":
		return "ar"
	case "Q9610":
		return "bn"
	case "Q9240":
		return "id"
	case "Q9217":
		return "th"
	case "Q9199":
		return "vi"
	case "Q36510":
		return "hi"
	case "Q1617":
		return "ur"
	case "Q36236":
		return "ta"
	case "Q36727":
		return "te"
	case "Q33810":
		return "mr"
	case "Q5885":
		return "gu"
	case "Q33954":
		return "kn"
	case "Q36343":
		return "ml"
	case "Q33997":
		return "pa"
	case "Q33890":
		return "or"
	default:
		return ""
	}
}

// mapWikidataPOSQID maps Wikidata POS QID to a standard POS string.
func mapWikidataPOSQID(qid string) string {
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
	case "Q62155":
		return "phrase"
	case "Q169872":
		return "abbreviation"
	case "Q187931":
		return "affix"
	case "Q1401131":
		return "prefix"
	case "Q102047":
		return "suffix"
	case "Q147276":
		return "proper noun"
	default:
		return qid
	}
}

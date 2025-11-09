package main

import (
	"archive/zip"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"

	_ "github.com/mattn/go-sqlite3"
)

type ecdictEnricher struct {
	mu            sync.Mutex
	entries       map[string]*ecdictEnrichment
	total         int
	applied       int64
	skipped       int64
	missingReport string
}

type ecdictEnrichment struct {
	phonetics  []*dictv1.Phonetic
	categories []string
	senses     []sensePayload
}

type sensePayload struct {
	language     commonv1.Language
	partOfSpeech string
	gloss        string
}

const maxUncompressedSQLite = 1000 << 20

func newECDICTEnricher(cfg pipelineConfig) (*ecdictEnricher, error) {
	log.Printf("[ecdict] loading enrichment data (url=%s)", cfg.ecdictURL)
	entries, total, err := loadECDICTEntries(cfg)
	if err != nil {
		return nil, err
	}
	log.Printf("[ecdict] ready: %d rows scanned, %d contain enrichment payloads", total, len(entries))
	return &ecdictEnricher{
		entries:       entries,
		total:         total,
		missingReport: cfg.ecdictMissingPath,
	}, nil
}

func (e *ecdictEnricher) Enrich(lexeme *dictv1.DictionaryEntry) {
	if lexeme == nil {
		return
	}
	lemma := strings.ToLower(strings.TrimSpace(lexeme.GetLemma()))
	if lemma == "" {
		return
	}

	e.mu.Lock()
	enrichment, ok := e.entries[lemma]
	if ok {
		delete(e.entries, lemma)
	}
	e.mu.Unlock()
	if !ok {
		atomic.AddInt64(&e.skipped, 1)
		return
	}

	if mergeEnrichment(lexeme, enrichment) {
		atomic.AddInt64(&e.applied, 1)
	} else {
		atomic.AddInt64(&e.skipped, 1)
	}
}

func (e *ecdictEnricher) ReportUnused() {
	if e == nil {
		return
	}
	e.mu.Lock()
	leftover := make([]string, 0, len(e.entries))
	for lemma := range e.entries {
		leftover = append(leftover, lemma)
	}
	e.mu.Unlock()

	log.Printf("[ecdict] applied=%d skipped=%d unused=%d (out of %d)",
		e.applied, e.skipped, len(leftover), e.total)

	if len(leftover) == 0 {
		return
	}

	if e.missingReport == "" {
		sort.Strings(leftover)
		show := leftover
		if len(show) > 10 {
			show = show[:10]
		}
		for _, lemma := range show {
			log.Printf("[ecdict] unused lemma: %s", lemma)
		}
		if len(leftover) > len(show) {
			log.Printf("[ecdict] ... plus %d more (set -ecdict-missing-report to persist)", len(leftover)-len(show))
		}
		return
	}

	path, err := expandHome(e.missingReport)
	if err != nil {
		log.Printf("[ecdict] resolve report path failed: %v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Printf("[ecdict] create report dir failed: %v", err)
		return
	}
	sort.Strings(leftover)
	if err := os.WriteFile(path, []byte(strings.Join(leftover, "\n")), 0o644); err != nil {
		log.Printf("[ecdict] write missing report failed: %v", err)
		return
	}
	log.Printf("[ecdict] wrote %d unused lemmas to %s", len(leftover), path)
}

func loadECDICTEntries(cfg pipelineConfig) (map[string]*ecdictEnrichment, int, error) {
	tmpDir, err := os.MkdirTemp("", "ecdict-*")
	if err != nil {
		return nil, 0, err
	}
	defer os.RemoveAll(tmpDir)

	cacheDir, zipPath, fromCache, err := prepareCachePath(cfg.ecdictURL, cfg.ecdictCacheDir, cfg.ecdictNoCache)
	if err != nil {
		return nil, 0, err
	}
	if !fromCache {
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			return nil, 0, fmt.Errorf("create cache dir: %w", err)
		}
		if err := downloadFile(context.Background(), cfg.ecdictURL, zipPath); err != nil {
			return nil, 0, err
		}
	} else {
		log.Printf("[ecdict] using cached archive %s", zipPath)
	}

	sqlitePath, err := unzipSingle(func(name string) bool {
		return strings.HasSuffix(name, ".db") || strings.HasSuffix(name, ".sqlite")
	}, zipPath, tmpDir)
	if err != nil {
		return nil, 0, err
	}

	db, err := sql.Open("sqlite3", sqlitePath)
	if err != nil {
		return nil, 0, err
	}
	defer db.Close()

	rows, err := db.Query(`SELECT word, phonetic, definition, pos, translation, exchange, tag FROM stardict`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	entries := make(map[string]*ecdictEnrichment, 500000)
	total := 0
	for rows.Next() {
		var r wordRecord
		if err := rows.Scan(&r.Word, &r.Phonetic, &r.Definition, &r.Pos, &r.Translation, &r.Exchange, &r.Tags); err != nil {
			return nil, 0, err
		}
		total++

		r.Word = strings.TrimSpace(r.Word)
		if r.Word == "" || !isSingleWord(r.Word) || isAllEmpty(r) {
			continue
		}
		enrichment := buildEnrichment(r)
		if enrichment.isEmpty() {
			continue
		}
		key := strings.ToLower(r.Word)
		entries[key] = enrichment
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return entries, total, nil
}

func mergeEnrichment(lexeme *dictv1.DictionaryEntry, enrich *ecdictEnrichment) bool {
	if enrich == nil || enrich.isEmpty() {
		return false
	}
	changed := false

	if len(enrich.phonetics) > 0 {
		if addPhonetics(lexeme, enrich.phonetics) {
			changed = true
		}
	}
	if len(enrich.categories) > 0 {
		if addCategories(lexeme, enrich.categories) {
			changed = true
		}
	}
	if len(enrich.senses) > 0 {
		if addSenses(lexeme, enrich.senses) {
			changed = true
		}
	}
	return changed
}

// Helper functions reused from legacy importer --------------------------------

type wordRecord struct {
	Word        string
	Phonetic    sql.NullString
	Definition  sql.NullString
	Pos         sql.NullString
	Translation sql.NullString
	Exchange    sql.NullString
	Tags        sql.NullString
}

func buildEnrichment(r wordRecord) *ecdictEnrichment {
	return &ecdictEnrichment{
		phonetics:  buildPhonetics(r.Phonetic),
		categories: buildTags(r.Tags),
		senses:     buildSensePayloads(r),
	}
}

func (e *ecdictEnrichment) isEmpty() bool {
	return len(e.phonetics) == 0 && len(e.categories) == 0 && len(e.senses) == 0
}

func addPhonetics(lexeme *dictv1.DictionaryEntry, additions []*dictv1.Phonetic) bool {
	existing := make(map[string]struct{}, len(lexeme.Phonetics))
	for _, p := range lexeme.Phonetics {
		existing[phoneticKey(p)] = struct{}{}
	}
	changed := false
	for _, add := range additions {
		key := phoneticKey(add)
		if _, ok := existing[key]; ok {
			continue
		}
		existing[key] = struct{}{}
		lexeme.Phonetics = append(lexeme.Phonetics, &dictv1.Phonetic{
			Ipa:     strings.TrimSpace(add.GetIpa()),
			Dialect: strings.TrimSpace(add.GetDialect()),
		})
		changed = true
	}
	return changed
}

func addCategories(lexeme *dictv1.DictionaryEntry, categories []string) bool {
	if len(categories) == 0 {
		return false
	}
	existing := make(map[string]struct{}, len(lexeme.Categories))
	for _, cat := range lexeme.Categories {
		existing[strings.ToLower(cat)] = struct{}{}
	}
	changed := false
	for _, cat := range categories {
		norm := strings.ToLower(strings.TrimSpace(cat))
		if norm == "" {
			continue
		}
		if _, ok := existing[norm]; ok {
			continue
		}
		existing[norm] = struct{}{}
		lexeme.Categories = append(lexeme.Categories, cat)
		changed = true
	}
	return changed
}

func addSenses(lexeme *dictv1.DictionaryEntry, additions []sensePayload) bool {
	if len(additions) == 0 {
		return false
	}
	existing := make(map[string]struct{})
	for _, def := range lexeme.GetDefinitions() {
		pos := def.GetPartOfSpeech()
		for _, sense := range def.GetSenses() {
			existing[senseKey(sense.GetLanguage(), pos, sense.GetGloss())] = struct{}{}
		}
	}

	changed := false
	allowEnglish := !lexemeHasEnglishSense(lexeme)
	for _, add := range additions {
		if add.language == commonv1.Language_LANGUAGE_ENGLISH && !allowEnglish {
			continue
		}
		key := senseKey(add.language, add.partOfSpeech, add.gloss)
		if _, ok := existing[key]; ok {
			continue
		}
		def := ensureDefinition(lexeme, add.partOfSpeech)
		def.Senses = append(def.Senses, &dictv1.LexemeSense{
			Id:       generateSenseID(lexeme.GetId(), key),
			Language: add.language,
			Gloss:    add.gloss,
		})
		existing[key] = struct{}{}
		changed = true
	}
	return changed
}

func ensureDefinition(lexeme *dictv1.DictionaryEntry, pos string) *dictv1.Definition {
	pos = strings.TrimSpace(pos)
	for _, def := range lexeme.GetDefinitions() {
		if strings.EqualFold(strings.TrimSpace(def.GetPartOfSpeech()), pos) {
			return def
		}
	}
	def := &dictv1.Definition{
		Id:           fmt.Sprintf("%s-ecdict-def-%d", lexeme.GetId(), len(lexeme.GetDefinitions())+1),
		PartOfSpeech: pos,
	}
	lexeme.Definitions = append(lexeme.Definitions, def)
	return def
}

func lexemeHasEnglishSense(lexeme *dictv1.DictionaryEntry) bool {
	for _, def := range lexeme.GetDefinitions() {
		for _, sense := range def.GetSenses() {
			if sense.GetLanguage() == commonv1.Language_LANGUAGE_ENGLISH {
				return true
			}
		}
	}
	return false
}

func phoneticKey(p *dictv1.Phonetic) string {
	return strings.ToLower(strings.TrimSpace(p.GetIpa())) + "|" + strings.ToLower(strings.TrimSpace(p.GetDialect()))
}

func senseKey(lang commonv1.Language, pos, gloss string) string {
	return fmt.Sprintf("%d|%s|%s", lang, strings.ToLower(strings.TrimSpace(pos)), strings.ToLower(strings.TrimSpace(gloss)))
}

func generateSenseID(lexemeID, key string) string {
	sum := crc32.ChecksumIEEE([]byte(key))
	return fmt.Sprintf("%s-ecdict-%08x", lexemeID, sum)
}

func buildPhonetics(ns sql.NullString) []*dictv1.Phonetic {
	if !ns.Valid {
		return nil
	}
	ipa := strings.TrimSpace(ns.String)
	if ipa == "" {
		return nil
	}
	return []*dictv1.Phonetic{{Ipa: ipa, Dialect: "en-US"}}
}

func buildTags(ns sql.NullString) []string {
	if !ns.Valid {
		return nil
	}
	s := strings.TrimSpace(ns.String)
	if s == "" {
		return nil
	}
	s = strings.ReplaceAll(s, ",", " ")
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(parts))
	ordered := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		norm := strings.ToLower(p)
		if _, ok := seen[norm]; ok {
			continue
		}
		seen[norm] = struct{}{}
		ordered = append(ordered, p)
	}
	if len(ordered) == 0 {
		return nil
	}
	return ordered
}

func buildSensePayloads(w wordRecord) []sensePayload {
	defLines := splitLines(nullStringVal(w.Definition))
	transLines := splitLines(nullStringVal(w.Translation))
	if len(defLines) == 0 && len(transLines) == 0 {
		return nil
	}

	var results []sensePayload
	for _, line := range defLines {
		pos, rest := extractLeadingPOS(line)
		if rest == "" {
			continue
		}
		results = append(results, sensePayload{
			language:     commonv1.Language_LANGUAGE_ENGLISH,
			partOfSpeech: pos,
			gloss:        rest,
		})
	}
	for _, line := range transLines {
		pos, rest := extractLeadingPOS(line)
		if rest == "" {
			continue
		}
		results = append(results, sensePayload{
			language:     commonv1.Language_LANGUAGE_CHINESE,
			partOfSpeech: pos,
			gloss:        rest,
		})
	}
	return results
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, "\n")
	res := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			res = append(res, p)
		}
	}
	return res
}

func extractLeadingPOS(line string) (string, string) {
	s := strings.TrimSpace(line)
	if s == "" {
		return "", ""
	}
	lower := strings.ToLower(s)
	candidates := []string{"vt", "vi", "adj", "adv", "prep", "pron", "conj", "interj", "int", "num", "art", "aux", "abbr", "pref", "suf", "noun", "n", "v"}
	for _, cand := range candidates {
		if len(lower) < len(cand) {
			continue
		}
		if strings.HasPrefix(lower, cand) {
			rest := s[len(cand):]
			if rest == "" {
				break
			}
			next := rest[0]
			if next != '.' && next != ' ' && next != '\t' {
				continue
			}
			rest = strings.TrimSpace(strings.TrimPrefix(rest, "."))
			return normalizePOS(cand), rest
		}
	}
	return "", s
}

func normalizePOS(pos string) string {
	if pos == "noun" {
		pos = "n"
	}
	return pos + "."
}

func prepareCachePath(url, cacheDirFlag string, noCache bool) (string, string, bool, error) {
	var base string
	if cacheDirFlag != "" {
		base = cacheDirFlag
	} else {
		userCache, err := os.UserCacheDir()
		if err != nil {
			return "", "", false, fmt.Errorf("get user cache dir: %w", err)
		}
		base = filepath.Join(userCache, "vocnet")
	}
	h := crc32.ChecksumIEEE([]byte(url))
	name := fmt.Sprintf("ecdict-%08x.zip", h)
	zipPath := filepath.Join(base, name)
	if !noCache {
		if st, err := os.Stat(zipPath); err == nil && st.Size() > 0 {
			return base, zipPath, true, nil
		}
	}
	return base, zipPath, false, nil
}

func downloadFile(ctx context.Context, url, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", resp.Status)
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, resp.Body); err != nil {
		return err
	}
	return nil
}

func unzipSingle(match func(string) bool, zipPath, dstDir string) (string, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if match(f.Name) {
			if f.UncompressedSize64 > maxUncompressedSQLite {
				return "", fmt.Errorf("uncompressed size %d exceeds safety limit", f.UncompressedSize64)
			}
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			defer rc.Close()
			outPath := filepath.Join(dstDir, filepath.Base(f.Name))
			out, err := os.Create(outPath)
			if err != nil {
				return "", err
			}
			size, err := safeUint64ToInt64(f.UncompressedSize64)
			if err != nil {
				out.Close()
				return "", err
			}
			written, err := io.CopyN(out, rc, size)
			if err != nil && !errors.Is(err, io.EOF) {
				out.Close()
				return "", err
			}
			if written != size {
				out.Close()
				return "", fmt.Errorf("unexpected truncated copy: wrote %d bytes of %d", written, f.UncompressedSize64)
			}
			out.Close()
			return outPath, nil
		}
	}
	return "", errors.New("sqlite file not found in archive")
}

func safeUint64ToInt64(v uint64) (int64, error) {
	if v > math.MaxInt64 {
		return 0, fmt.Errorf("value %d exceeds int64 capacity", v)
	}
	return int64(v), nil
}

func isSingleWord(w string) bool {
	if strings.ContainsAny(w, " \t\n") {
		return false
	}
	if strings.ContainsAny(w, ",;") {
		return false
	}
	return true
}

func isAllEmpty(r wordRecord) bool {
	return strings.TrimSpace(nullStringVal(r.Phonetic)) == "" &&
		strings.TrimSpace(nullStringVal(r.Definition)) == "" &&
		strings.TrimSpace(nullStringVal(r.Pos)) == "" &&
		strings.TrimSpace(nullStringVal(r.Translation)) == "" &&
		strings.TrimSpace(nullStringVal(r.Exchange)) == ""
}

func nullStringVal(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

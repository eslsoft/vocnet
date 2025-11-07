package main

import (
	"archive/zip"
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"hash/crc32"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"connectrpc.com/connect"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
	_ "github.com/mattn/go-sqlite3"
)

const (
	defaultECDictURL      = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
	maxUncompressedSQLite = 1000 << 20
	defaultBatchSize      = 10
	defaultAPIBase        = "http://localhost:8080"
)

type wordRecord struct {
	Word        string
	Phonetic    sql.NullString
	Definition  sql.NullString
	Pos         sql.NullString
	Translation sql.NullString
	Exchange    sql.NullString
	Tags        sql.NullString
}

type inflectionRel struct {
	Lemma string
	Type  string
}

func main() {
	url := flag.String("url", defaultECDictURL, "ECDICT download URL")
	batchSize := flag.Int("batch", defaultBatchSize, "Batch size for API calls")
	apiBase := flag.String("api", defaultAPIBase, "API base URL")
	cacheDir := flag.String("cache-dir", "", "Cache directory (default: user cache dir/vocnet)")
	noCache := flag.Bool("no-cache", false, "Ignore local cache and force re-download")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("Starting ECDICT import")
	log.Printf("URL: %s", *url)
	log.Printf("API: %s", *apiBase)
	log.Printf("Batch: %d", *batchSize)

	start := time.Now()
	if err := run(*url, *batchSize, *apiBase, *cacheDir, *noCache); err != nil {
		log.Fatalf("Import failed: %v", err)
	}
	log.Printf("Import completed in %s", time.Since(start))
}

func run(url string, batchSize int, apiBase, cacheDirFlag string, noCache bool) error {
	tmpDir, err := os.MkdirTemp("", "ecdict-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	cacheDir, zipPath, fromCache, err := prepareCachePath(url, cacheDirFlag, noCache)
	if err != nil {
		return err
	}
	if !fromCache {
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			return fmt.Errorf("create cache dir: %w", err)
		}
		log.Printf("Downloading ECDICT to cache: %s", zipPath)
		if err := downloadFile(context.Background(), url, zipPath); err != nil {
			return err
		}
	} else {
		log.Printf("Using cached file: %s", zipPath)
	}

	sqlitePath, err := unzipSingle(func(name string) bool {
		return strings.HasSuffix(name, ".db") || strings.HasSuffix(name, ".sqlite")
	}, zipPath, tmpDir)
	if err != nil {
		return err
	}
	log.Printf("Extracted sqlite: %s", sqlitePath)

	sqldb, err := sql.Open("sqlite3", sqlitePath)
	if err != nil {
		return err
	}
	defer sqldb.Close()

	rows, err := sqldb.Query(`SELECT word, phonetic, definition, pos, translation, exchange, tag FROM stardict`)
	if err != nil {
		return err
	}
	defer rows.Close()

	records := make([]wordRecord, 0, 500000)
	for rows.Next() {
		var r wordRecord
		if err := rows.Scan(&r.Word, &r.Phonetic, &r.Definition, &r.Pos, &r.Translation, &r.Exchange, &r.Tags); err != nil {
			return err
		}
		r.Word = strings.TrimSpace(r.Word)
		if r.Word == "" || !isSingleWord(r.Word) || isAllEmpty(r) {
			continue
		}
		records = append(records, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	log.Printf("Loaded %d records from ECDICT", len(records))

	inflectionMap := buildInflectionMap(records)
	log.Printf("Built inflection map with %d entries", len(inflectionMap))

	return importBatch(apiBase, records, inflectionMap, batchSize)
}

func buildInflectionMap(records []wordRecord) map[string]inflectionRel {
	inflectionMap := make(map[string]inflectionRel)
	for _, r := range records {
		exchange := strings.TrimSpace(nullStringVal(r.Exchange))
		if exchange == "" {
			continue
		}
		pairs := parseExchangePairs(exchange)
		for _, p := range pairs {
			if p.code == "lemma" {
				continue
			}
			lw := strings.ToLower(p.word)
			if lw == "" || lw == strings.ToLower(r.Word) {
				continue
			}
			if _, exists := inflectionMap[lw]; !exists {
				inflectionMap[lw] = inflectionRel{Lemma: r.Word, Type: p.code}
			}
		}
	}
	return inflectionMap
}

func importBatch(apiBase string, records []wordRecord, inflectionMap map[string]inflectionRel, batchSize int) error {
	httpClient := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        batchSize,
			MaxIdleConnsPerHost: batchSize,
			MaxConnsPerHost:     batchSize,
			IdleConnTimeout:     90 * time.Second,
		},
	}
	client := dictv1connect.NewWordServiceClient(httpClient, apiBase)

	type result struct {
		word    string
		success bool
		err     error
	}

	resultCh := make(chan result, batchSize)
	semaphore := make(chan struct{}, batchSize)

	total := 0
	failed := 0
	processed := 0

	for i, r := range records {
		word := buildWordProto(r, inflectionMap)
		if word == nil {
			continue
		}

		semaphore <- struct{}{}

		go func(r wordRecord, word *dictv1.Word) {
			defer func() { <-semaphore }()

			req := &dictv1.CreateWordRequest{Word: word}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			_, err := client.CreateWord(ctx, connect.NewRequest(req))
			resultCh <- result{word: r.Word, success: err == nil, err: err}
		}(r, word)

		processed++

		if processed%batchSize == 0 || i == len(records)-1 {
			for j := 0; j < min(processed, batchSize); j++ {
				res := <-resultCh
				if res.success {
					total++
				} else {
					log.Printf("Failed to create word %s: %v", res.word, res.err)
					failed++
				}
			}
			log.Printf("Progress: %d/%d, succeeded: %d, failed: %d", i+1, len(records), total, failed)
			processed = 0
		}
	}

	for i := 0; i < cap(semaphore); i++ {
		semaphore <- struct{}{}
	}

	close(resultCh)
	for res := range resultCh {
		if res.success {
			total++
		} else {
			log.Printf("Failed to create word %s: %v", res.word, res.err)
			failed++
		}
	}

	log.Printf("Import finished: %d succeeded, %d failed", total, failed)
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func buildWordProto(r wordRecord, inflectionMap map[string]inflectionRel) *dictv1.Word {
	phonetics := buildPhonetics(r.Phonetic)
	definitions := buildDefinitions(r)
	if len(phonetics) == 0 && len(definitions) == 0 {
		return nil
	}

	wordType := "lemma"
	lemma := ""
	if rel, ok := inflectionMap[strings.ToLower(r.Word)]; ok {
		if !strings.EqualFold(rel.Lemma, r.Word) {
			wordType = rel.Type
			lemma = rel.Lemma
		}
	}

	word := &dictv1.Word{
		Text:        r.Word,
		Language:    commonv1.Language_LANGUAGE_ENGLISH,
		WordType:    wordType,
		Lemma:       lemma,
		Phonetics:   phonetics,
		Definitions: definitions,
	}

	if tags := buildTags(r.Tags); len(tags) > 0 {
		word.Categories = tags
	}

	return word
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

func buildDefinitions(w wordRecord) []*dictv1.Definition {
	defLines := splitLines(nullStringVal(w.Definition))
	transLines := splitLines(nullStringVal(w.Translation))
	if len(defLines) == 0 && len(transLines) == 0 {
		return nil
	}

	var results []*dictv1.Definition
	for _, line := range defLines {
		pos, rest := extractLeadingPOS(line)
		if rest == "" {
			continue
		}
		results = append(results, &dictv1.Definition{
			Pos:      pos,
			Text:     rest,
			Language: commonv1.Language_LANGUAGE_ENGLISH,
		})
	}
	for _, line := range transLines {
		pos, rest := extractLeadingPOS(line)
		if rest == "" {
			continue
		}
		results = append(results, &dictv1.Definition{
			Pos:      pos,
			Text:     rest,
			Language: commonv1.Language_LANGUAGE_CHINESE,
		})
	}
	return results
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
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		ordered = append(ordered, p)
	}
	if len(ordered) == 0 {
		return nil
	}
	return ordered
}

func extractLeadingPOS(line string) (string, string) {
	s := strings.TrimSpace(line)
	if s == "" {
		return "", ""
	}
	lower := strings.ToLower(s)
	candidates := []string{"vt", "vi", "adj", "adv", "prep", "pron", "conj", "interj", "int", "num", "art", "aux", "abbr", "pref", "suf", "noun", "n", "v"}
	for _, cand := range candidates {
		matchLen := len(cand)
		if len(lower) < matchLen {
			continue
		}
		if strings.HasPrefix(lower, cand) {
			rest := s[matchLen:]
			if rest == "" {
				break
			}
			next := rest[0]
			if next != '.' && next != ' ' && next != '\t' {
				continue
			}
			rest = strings.TrimSpace(strings.TrimPrefix(rest, "."))
			pos := normalizePOSWithDot(cand)
			return pos, rest
		}
	}
	return "", s
}

func normalizePOSWithDot(pos string) string {
	if pos == "noun" {
		pos = "n"
	}
	return pos + "."
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

type exchangePair struct {
	code string
	word string
}

func parseExchangePairs(s string) []exchangePair {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, "/")
	out := make([]exchangePair, 0, len(parts))
	seen := make(map[string]struct{})
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		code := "other"
		val := part
		if left, right, ok := strings.Cut(part, ":"); ok {
			code = left
			val = right
		}
		val = strings.TrimSpace(val)
		if val == "" {
			continue
		}
		norm := normalizeExchangeCode(code)
		key := norm + "|" + strings.ToLower(val)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, exchangePair{code: norm, word: val})
	}
	return out
}

func normalizeExchangeCode(c string) string {
	switch c {
	case "p":
		return "past"
	case "d":
		return "pp"
	case "i":
		return "ing"
	case "3":
		return "3sg"
	case "r":
		return "comparative"
	case "t":
		return "superlative"
	case "s":
		return "plural"
	case "0":
		return "lemma"
	case "1":
		return "variant"
	default:
		return c
	}
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
	return "", errors.New("sqlite file not found in zip")
}

func safeUint64ToInt64(v uint64) (int64, error) {
	if v > math.MaxInt64 {
		return 0, fmt.Errorf("value %d exceeds int64 capacity", v)
	}
	return int64(v), nil
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

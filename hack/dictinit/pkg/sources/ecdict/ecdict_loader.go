package ecdict

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
	"strings"
	"time"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"

	_ "github.com/mattn/go-sqlite3"
)

const (
	maxUncompressedSQLite = 1000 << 20
	downloadTimeout       = 10 * time.Minute
)

func loadECDICTEntries(url, cacheDir string, noCache bool) (map[string]*ecdictEnrichment, int, error) {
	tmpDir, err := os.MkdirTemp("", "ecdict-*")
	if err != nil {
		return nil, 0, err
	}
	defer os.RemoveAll(tmpDir)

	cacheDir, zipPath, fromCache, err := prepareCachePath(url, cacheDir, noCache)
	if err != nil {
		return nil, 0, err
	}
	if !fromCache {
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			return nil, 0, fmt.Errorf("create cache dir: %w", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), downloadTimeout)
		defer cancel()
		if err := downloadFile(ctx, url, zipPath); err != nil {
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

	rows, err := db.Query(`SELECT word, phonetic, definition, pos, translation, exchange, tag, bnc, frq, collins, oxford FROM stardict`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	entries := make(map[string]*ecdictEnrichment, 500000)
	total := 0
	for rows.Next() {
		var r wordRecord
		if err := rows.Scan(&r.Word, &r.Phonetic, &r.Definition, &r.Pos, &r.Translation, &r.Exchange, &r.Tags, &r.BNC, &r.FRQ, &r.Collins, &r.Oxford); err != nil {
			return nil, 0, err
		}
		total++

		r.Word = strings.TrimSpace(r.Word)
		// Allow both single words and phrases (multi-word expressions)
		// Only skip if empty or contains invalid characters
		if r.Word == "" || containsInvalidChars(r.Word) || isAllEmpty(r) {
			continue
		}
		enrichment := buildEnrichment(r)
		if enrichment.isEmpty() {
			continue
		}
		key := util.NormalizeKey(r.Word)
		entries[key] = enrichment
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return entries, total, nil
}

type wordRecord struct {
	Word        string
	Phonetic    sql.NullString
	Definition  sql.NullString
	Pos         sql.NullString
	Translation sql.NullString
	Exchange    sql.NullString
	Tags        sql.NullString
	BNC         sql.NullInt64 // British National Corpus frequency rank
	FRQ         sql.NullInt64 // Contemporary Corpus frequency rank
	Collins     sql.NullInt64 // Collins star rating (1-5)
	Oxford      sql.NullInt64 // Oxford 3000 core vocabulary (0 or 1)
}

func buildEnrichment(r wordRecord) *ecdictEnrichment {
	// Extract domain markers from definition/translation
	var allDomains []string
	if r.Definition.Valid {
		allDomains = append(allDomains, extractDomainMarkers(r.Definition.String)...)
	}
	if r.Translation.Valid {
		allDomains = append(allDomains, extractDomainMarkers(r.Translation.String)...)
	}

	return &ecdictEnrichment{
		phonetics:   buildPhonetics(r.Phonetic),
		categories:  buildTags(r.Tags),
		domains:     deduplicateDomains(allDomains),
		senses:      buildSensePayloads(r),
		translation: nullStringVal(r.Translation),
		exchange:    nullStringVal(r.Exchange),
		bnc:         nullInt64Val(r.BNC),
		frq:         nullInt64Val(r.FRQ),
		collins:     int(nullInt64Val(r.Collins)),
		oxford:      nullInt64Val(r.Oxford) > 0,
	}
}

func (e *ecdictEnrichment) isEmpty() bool {
	return len(e.phonetics) == 0 && len(e.categories) == 0 && len(e.domains) == 0 && len(e.senses) == 0
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

	tmpFile, err := os.CreateTemp(filepath.Dir(path), "ecdict-*.zip")
	if err != nil {
		return err
	}
	tmpName := tmpFile.Name()
	defer os.Remove(tmpName)

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		tmpFile.Close()
		return err
	}
	if err := tmpFile.Sync(); err != nil {
		tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	if err := os.Rename(tmpName, path); err != nil {
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

// containsInvalidChars checks if the word contains invalid characters
// Allows spaces (for phrases) but rejects commas, semicolons, tabs, newlines
func containsInvalidChars(w string) bool {
	// Reject tabs and newlines (spaces are OK for phrases)
	if strings.ContainsAny(w, "\t\n") {
		return true
	}
	// Reject comma-separated lists or semicolons
	if strings.ContainsAny(w, ",;") {
		return true
	}
	return false
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

func nullInt64Val(ni sql.NullInt64) int64 {
	if ni.Valid {
		return ni.Int64
	}
	return 0
}

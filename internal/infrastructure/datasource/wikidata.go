package datasource

import (
	"compress/bzip2"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

const (
	wikidataLexemesURL      = "https://dumps.wikimedia.org/wikidatawiki/entities/latest-lexemes.json.bz2"
	wikidataLexemesFilename = "lexemes.json"
	wikidataCacheFilename   = "wikidata-lexemes.json.bz2"
)

// WikidataSource implements DataSource for Wikidata lexemes data
type WikidataSource struct {
	path     string
	cacheDir string
	logger   *slog.Logger
}

// NewWikidataSource creates a new Wikidata data source
func NewWikidataSource(dataDir, cacheDir string, logger *slog.Logger) *WikidataSource {
	return &WikidataSource{
		path:     filepath.Join(dataDir, "wikidata", wikidataLexemesFilename),
		cacheDir: cacheDir,
		logger:   logger,
	}
}

func (s *WikidataSource) Name() string {
	return "Wikidata"
}

func (s *WikidataSource) Path() string {
	return s.path
}

func (s *WikidataSource) DownloadURL() string {
	return wikidataLexemesURL
}

func (s *WikidataSource) Exists() bool {
	st, err := os.Stat(s.path)
	return err == nil && !st.IsDir() && st.Size() > 0
}

func (s *WikidataSource) Download(ctx context.Context) error {
	destDir := filepath.Dir(s.path)

	// Create destination directory
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}

	// Check cache
	cachePath, fromCache, err := prepareCachePath(wikidataLexemesURL, s.cacheDir, wikidataCacheFilename)
	if err != nil {
		return fmt.Errorf("prepare cache: %w", err)
	}

	// Download if not cached
	if !fromCache {
		s.logger.Info("downloading Wikidata lexemes", "url", wikidataLexemesURL)
		ctx, cancel := context.WithTimeout(ctx, downloadTimeout)
		defer cancel()

		if err := downloadWithProgress(ctx, wikidataLexemesURL, cachePath, s.logger); err != nil {
			return fmt.Errorf("download: %w", err)
		}
	} else {
		s.logger.Info("using cached Wikidata lexemes", "path", cachePath)
	}

	// Extract .bz2 file
	if err := extractBz2(cachePath, s.path, s.logger); err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	// Build SQLite index (only if needed)
	indexer := NewWikidataIndexer(s.path, s.logger)
	if indexer.NeedsIndex() {
		if err := indexer.BuildIndex(); err != nil {
			return fmt.Errorf("build index: %w", err)
		}
	}

	return nil
}

func (s *WikidataSource) Verify() error {
	st, err := os.Stat(s.path)
	if err != nil {
		return fmt.Errorf("stat file: %w", err)
	}

	if st.IsDir() {
		return fmt.Errorf("expected file, got directory")
	}

	// Wikidata lexemes JSON should be at least 1GB
	minSize := int64(1 << 30)
	if st.Size() < minSize {
		return fmt.Errorf("file too small: %d bytes (expected > %d)", st.Size(), minSize)
	}

	// Check if file is readable and looks like JSON
	f, err := os.Open(s.path)
	if err != nil {
		return fmt.Errorf("open file: %w", err)
	}
	defer func() { _ = f.Close() }()

	// Read first few bytes to ensure it's readable and starts with JSON
	buf := make([]byte, 1024)
	n, err := f.Read(buf)
	if err != nil {
		return fmt.Errorf("read file: %w", err)
	}

	// Check if it looks like JSON (starts with { or [)
	for i := range n {
		if buf[i] == '{' || buf[i] == '[' {
			break
		}
		if buf[i] != ' ' && buf[i] != '\n' && buf[i] != '\r' && buf[i] != '\t' {
			return fmt.Errorf("file does not appear to be JSON")
		}
	}

	// Verify SQLite index exists and is valid
	indexer := NewWikidataIndexer(s.path, nil)
	if indexer.NeedsIndex() {
		return fmt.Errorf("SQLite index missing or invalid")
	}

	return nil
}

// extractBz2 extracts a .bz2 file to destination
func extractBz2(archivePath, destPath string, logger *slog.Logger) error {
	logger.Info("extracting bzip2", "archive", archivePath, "dest", destPath)

	f, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open archive: %w", err)
	}
	defer func() { _ = f.Close() }()

	bzr := bzip2.NewReader(f)

	// Create parent directory
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return fmt.Errorf("create parent dir: %w", err)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create output file: %w", err)
	}
	defer func() { _ = out.Close() }()

	if _, err := io.Copy(out, bzr); err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	logger.Info("extraction completed", "path", destPath)
	return nil
}

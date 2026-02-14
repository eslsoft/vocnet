package wikidata

import (
	"compress/bzip2"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
)

const (
	wikidataLexemesURL      = "https://dumps.wikimedia.org/wikidatawiki/entities/latest-lexemes.json.bz2"
	wikidataLexemesFilename = "lexemes.json"
)

// Source implements DataSource for Wikidata lexemes data.
type Source struct {
	path       string
	logger     *slog.Logger
	downloader *datasource.Downloader
}

// DataPath returns the Wikidata lexeme JSON path under fixed datasource layout.
func DataPath(dataDir string) string {
	return filepath.Join(dataDir, "datasources", "wikidata", wikidataLexemesFilename)
}

// NewSource creates a new Wikidata data source.
func NewSource(dataDir string, downloader *datasource.Downloader, logger *slog.Logger) *Source {
	return &Source{
		path:       DataPath(dataDir),
		logger:     logger,
		downloader: downloader,
	}
}

func (s *Source) Name() string {
	return "wikidata"
}

func (s *Source) Path() string {
	return s.path
}

func (s *Source) DownloadURL() string {
	return wikidataLexemesURL
}

func (s *Source) Exists() bool {
	st, err := os.Stat(s.path)
	return err == nil && !st.IsDir() && st.Size() > 0
}

func (s *Source) Download(ctx context.Context) error {
	destDir := filepath.Dir(s.path)

	// Create destination directory
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}

	artifactPath, err := s.downloader.Fetch(ctx, datasource.DownloadRequest{
		Source: s.Name(),
		URL:    wikidataLexemesURL,
	})
	if err != nil {
		return err
	}

	// Extract .bz2 file
	if err := extractBz2(artifactPath, s.path, s.logger); err != nil {
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

func (s *Source) Verify() error {
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

// extractBz2 extracts a .bz2 file to destination.
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

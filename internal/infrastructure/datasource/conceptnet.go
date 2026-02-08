package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

const (
	conceptNetURL      = "https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz"
	conceptNetFilename = "conceptnet-assertions-5.7.0.csv"
)

// ConceptNetSource implements DataSource for ConceptNet data
type ConceptNetSource struct {
	path       string
	logger     *slog.Logger
	downloader *Downloader
}

// NewConceptNetSource creates a new ConceptNet data source
func NewConceptNetSource(dataDir string, downloader *Downloader, logger *slog.Logger) *ConceptNetSource {
	return &ConceptNetSource{
		path:       filepath.Join(dataDir, "conceptnet", conceptNetFilename),
		logger:     logger,
		downloader: downloader,
	}
}

func (s *ConceptNetSource) Name() string {
	return "ConceptNet"
}

func (s *ConceptNetSource) Path() string {
	return s.path
}

func (s *ConceptNetSource) DownloadURL() string {
	return conceptNetURL
}

func (s *ConceptNetSource) Exists() bool {
	st, err := os.Stat(s.path)
	return err == nil && !st.IsDir() && st.Size() > 0
}

func (s *ConceptNetSource) Download(ctx context.Context) error {
	destDir := filepath.Dir(s.path)

	// Create destination directory
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}

	artifactPath, err := s.downloader.Fetch(ctx, DownloadRequest{
		Source: s.Name(),
		URL:    conceptNetURL,
	})
	if err != nil {
		return err
	}

	// Extract .gz file
	if err := extractGz(artifactPath, s.path, s.logger); err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	// Build SQLite index
	indexer := NewConceptNetIndexer(s.path, s.logger)
	if err := indexer.BuildIndex(); err != nil {
		return fmt.Errorf("build index: %w", err)
	}

	return nil
}

func (s *ConceptNetSource) Verify() error {
	st, err := os.Stat(s.path)
	if err != nil {
		return fmt.Errorf("stat file: %w", err)
	}

	if st.IsDir() {
		return fmt.Errorf("expected file, got directory")
	}

	// ConceptNet CSV should be at least 100MB
	minSize := int64(100 << 20)
	if st.Size() < minSize {
		return fmt.Errorf("file too small: %d bytes (expected > %d)", st.Size(), minSize)
	}

	// Check if file is readable and not corrupted
	f, err := os.Open(s.path)
	if err != nil {
		return fmt.Errorf("open file: %w", err)
	}
	defer func() { _ = f.Close() }()

	// Read first few bytes to ensure it's readable
	buf := make([]byte, 1024)
	if _, err := f.Read(buf); err != nil {
		return fmt.Errorf("read file: %w", err)
	}

	// Verify SQLite index exists and is valid
	indexer := NewConceptNetIndexer(s.path, nil)
	if indexer.NeedsIndex() {
		return fmt.Errorf("SQLite index missing or invalid")
	}

	return nil
}

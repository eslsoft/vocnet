package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

const (
	wordNetURL      = "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz"
	wordNetFilename = "wn3.1.dict.tar.gz"
)

// WordNetSource implements DataSource for WordNet data
type WordNetSource struct {
	path       string
	logger     *slog.Logger
	downloader *Downloader
}

// NewWordNetSource creates a new WordNet data source
func NewWordNetSource(dataDir string, downloader *Downloader, logger *slog.Logger) *WordNetSource {
	return &WordNetSource{
		path:       filepath.Join(dataDir, "wordnet"),
		logger:     logger,
		downloader: downloader,
	}
}

func (s *WordNetSource) Name() string {
	return "WordNet"
}

func (s *WordNetSource) Path() string {
	return s.path
}

func (s *WordNetSource) DownloadURL() string {
	return wordNetURL
}

func (s *WordNetSource) Exists() bool {
	st, err := os.Stat(s.path)
	if err != nil {
		return false
	}

	// WordNet is a directory, check if it contains expected files
	if !st.IsDir() {
		return false
	}

	// Check for essential WordNet files
	essentialFiles := []string{"data.noun", "data.verb", "data.adj", "data.adv"}
	for _, file := range essentialFiles {
		filePath := filepath.Join(s.path, "dict", file)
		if _, err := os.Stat(filePath); err != nil {
			return false
		}
	}

	return true
}

func (s *WordNetSource) Download(ctx context.Context) error {
	// Create destination directory
	if err := os.MkdirAll(s.path, 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}

	artifactPath, err := s.downloader.Fetch(ctx, DownloadRequest{
		Source: s.Name(),
		URL:    wordNetURL,
	})
	if err != nil {
		return err
	}

	// Extract tar.gz
	if err := extractTarGz(artifactPath, s.path, s.logger); err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	return nil
}

func (s *WordNetSource) Verify() error {
	st, err := os.Stat(s.path)
	if err != nil {
		return fmt.Errorf("stat path: %w", err)
	}

	if !st.IsDir() {
		return fmt.Errorf("expected directory, got file")
	}

	// Check for essential WordNet files
	essentialFiles := []string{"data.noun", "data.verb", "data.adj", "data.adv"}
	for _, file := range essentialFiles {
		filePath := filepath.Join(s.path, "dict", file)
		st, err := os.Stat(filePath)
		if err != nil {
			return fmt.Errorf("missing file %s: %w", file, err)
		}
		if st.Size() == 0 {
			return fmt.Errorf("file %s is empty", file)
		}
	}

	return nil
}

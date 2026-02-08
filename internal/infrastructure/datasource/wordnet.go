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
	path     string
	cacheDir string
	logger   *slog.Logger
}

// NewWordNetSource creates a new WordNet data source
func NewWordNetSource(dataDir, cacheDir string, logger *slog.Logger) *WordNetSource {
	return &WordNetSource{
		path:     filepath.Join(dataDir, "wordnet"),
		cacheDir: cacheDir,
		logger:   logger,
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

	// Check cache
	cachePath, fromCache, err := prepareCachePath(wordNetURL, s.cacheDir, wordNetFilename)
	if err != nil {
		return fmt.Errorf("prepare cache: %w", err)
	}

	// Download if not cached
	if !fromCache {
		s.logger.Info("downloading WordNet", "url", wordNetURL)
		ctx, cancel := context.WithTimeout(ctx, downloadTimeout)
		defer cancel()

		if err := downloadWithProgress(ctx, wordNetURL, cachePath, s.logger); err != nil {
			return fmt.Errorf("download: %w", err)
		}
	} else {
		s.logger.Info("using cached WordNet", "path", cachePath)
	}

	// Extract tar.gz
	if err := extractTarGz(cachePath, s.path, s.logger); err != nil {
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

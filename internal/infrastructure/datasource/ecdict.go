package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

const (
	ecdictURL             = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
	ecdictDefaultFilename = "ecdict.db"
)

// ECDICTSource implements DataSource for ECDICT data
type ECDICTSource struct {
	path     string
	cacheDir string
	logger   *slog.Logger
}

// NewECDICTSource creates a new ECDICT data source
func NewECDICTSource(dataDir, cacheDir string, logger *slog.Logger) *ECDICTSource {
	return &ECDICTSource{
		path:     filepath.Join(dataDir, "ecdict", ecdictDefaultFilename),
		cacheDir: cacheDir,
		logger:   logger,
	}
}

func (s *ECDICTSource) Name() string {
	return "ECDICT"
}

func (s *ECDICTSource) Path() string {
	return s.path
}

func (s *ECDICTSource) DownloadURL() string {
	return ecdictURL
}

func (s *ECDICTSource) Exists() bool {
	st, err := os.Stat(s.path)
	return err == nil && !st.IsDir() && st.Size() > 0
}

func (s *ECDICTSource) Download(ctx context.Context) error {
	url := s.DownloadURL()

	destDir := filepath.Dir(s.path)

	// Create destination directory
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}

	// Check cache
	cachePath, fromCache, err := prepareCachePath(url, s.cacheDir, "ecdict.zip")
	if err != nil {
		return fmt.Errorf("prepare cache: %w", err)
	}

	// Download if not cached
	if !fromCache {
		s.logger.Info("downloading ECDICT", "url", url)
		ctx, cancel := context.WithTimeout(ctx, downloadTimeout)
		defer cancel()

		if err := downloadWithProgress(ctx, url, cachePath, s.logger); err != nil {
			return fmt.Errorf("download: %w", err)
		}
	} else {
		s.logger.Info("using cached ECDICT", "path", cachePath)
	}

	// Extract .db file from zip
	extractedPath, err := extractZipSingle(cachePath, destDir, func(name string) bool {
		return strings.HasSuffix(name, ".db") || strings.HasSuffix(name, ".sqlite")
	}, s.logger)
	if err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	// Rename to configured filename if different
	if extractedPath != s.path {
		if err := os.Rename(extractedPath, s.path); err != nil {
			return fmt.Errorf("rename: %w", err)
		}
	}

	return nil
}

func (s *ECDICTSource) Verify() error {
	st, err := os.Stat(s.path)
	if err != nil {
		return fmt.Errorf("stat file: %w", err)
	}

	if st.IsDir() {
		return fmt.Errorf("expected file, got directory")
	}

	// ECDICT SQLite database should be at least 10MB
	minSize := int64(10 << 20)
	if st.Size() < minSize {
		return fmt.Errorf("file too small: %d bytes (expected > %d)", st.Size(), minSize)
	}

	// Check if file is readable
	f, err := os.Open(s.path)
	if err != nil {
		return fmt.Errorf("open file: %w", err)
	}
	defer func() { _ = f.Close() }()

	// Read SQLite header to verify it's a valid database
	header := make([]byte, 16)
	if _, err := f.Read(header); err != nil {
		return fmt.Errorf("read header: %w", err)
	}

	// SQLite databases start with "SQLite format 3\x00"
	expectedHeader := "SQLite format 3\x00"
	if string(header) != expectedHeader {
		return fmt.Errorf("invalid SQLite header")
	}

	return nil
}

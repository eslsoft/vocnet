package moby

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
)

const (
	mobyURL      = "https://raw.githubusercontent.com/words/moby/master/words.txt"
	mobyFilename = "mhyph.txt"
)

// Source manages the Moby Hyphenation data source.
type Source struct {
	path       string
	logger     *slog.Logger
	downloader *datasource.Downloader
}

// DataPath returns the Moby data file path under fixed datasource layout.
func DataPath(dataDir string) string {
	return filepath.Join(dataDir, "datasources", "moby", mobyFilename)
}

// NewSource creates a new Moby data source.
func NewSource(dataDir string, downloader *datasource.Downloader, logger *slog.Logger) *Source {
	return &Source{
		path:       DataPath(dataDir),
		logger:     logger,
		downloader: downloader,
	}
}

func (s *Source) Name() string {
	return "moby"
}

func (s *Source) Path() string {
	return s.path
}

func (s *Source) DownloadURL() string {
	return mobyURL
}

func (s *Source) Exists() bool {
	info, err := os.Stat(s.path)
	if err != nil {
		return false
	}
	return !info.IsDir() && info.Size() > 0
}

func (s *Source) Download(ctx context.Context) error {
	if err := s.downloader.DownloadFile(ctx, datasource.DownloadRequest{
		Source: s.Name(),
		URL:    mobyURL,
	}, s.path, ".moby-*"); err != nil {
		return fmt.Errorf("copy cache to destination: %w", err)
	}

	// Verify download
	if err := s.Verify(); err != nil {
		// Clean up failed download
		_ = os.Remove(s.path)
		return fmt.Errorf("verify download: %w", err)
	}

	return nil
}

func (s *Source) Verify() error {
	// Check file exists
	info, err := os.Stat(s.path)
	if err != nil {
		return fmt.Errorf("moby data file not found: %w", err)
	}

	// Check it's not a directory
	if info.IsDir() {
		return fmt.Errorf("moby path is a directory, expected file: %s", s.path)
	}

	// Check file has content
	if info.Size() == 0 {
		return fmt.Errorf("moby data file is empty: %s", s.path)
	}

	// Basic content check - try to open and read first line
	file, err := os.Open(s.path)
	if err != nil {
		return fmt.Errorf("cannot open moby file: %w", err)
	}
	defer func() { _ = file.Close() }()

	// Read first few bytes to verify it's a text file
	buf := make([]byte, 100)
	n, err := file.Read(buf)
	if err != nil && n == 0 {
		return fmt.Errorf("cannot read moby file: %w", err)
	}

	return nil
}

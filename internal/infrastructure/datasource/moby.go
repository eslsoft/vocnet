package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

const (
	mobyURL      = "https://raw.githubusercontent.com/words/moby/master/words.txt"
	mobyFilename = "mhyph.txt"
)

// MobySource manages the Moby Hyphenation data source
type MobySource struct {
	path       string
	logger     *slog.Logger
	downloader *Downloader
}

// MobyDataPath returns the Moby data file path under fixed datasource layout.
func MobyDataPath(dataDir string) string {
	return filepath.Join(dataDir, "datasources", "moby", mobyFilename)
}

// NewMobySource creates a new Moby data source
func NewMobySource(dataDir string, downloader *Downloader, logger *slog.Logger) *MobySource {
	return &MobySource{
		path:       MobyDataPath(dataDir),
		logger:     logger,
		downloader: downloader,
	}
}

func (m *MobySource) Name() string {
	return "Moby"
}

func (m *MobySource) Path() string {
	return m.path
}

func (m *MobySource) DownloadURL() string {
	return mobyURL
}

func (m *MobySource) Exists() bool {
	info, err := os.Stat(m.path)
	if err != nil {
		return false
	}
	return !info.IsDir() && info.Size() > 0
}

func (m *MobySource) Download(ctx context.Context) error {
	if err := m.downloader.DownloadFile(ctx, DownloadRequest{
		Source: m.Name(),
		URL:    mobyURL,
	}, m.path, ".moby-*"); err != nil {
		return fmt.Errorf("copy cache to destination: %w", err)
	}

	// Verify download
	if err := m.Verify(); err != nil {
		// Clean up failed download
		_ = os.Remove(m.path)
		return fmt.Errorf("verify download: %w", err)
	}

	return nil
}

func (m *MobySource) Verify() error {
	// Check file exists
	info, err := os.Stat(m.path)
	if err != nil {
		return fmt.Errorf("moby data file not found: %w", err)
	}

	// Check it's not a directory
	if info.IsDir() {
		return fmt.Errorf("moby path is a directory, expected file: %s", m.path)
	}

	// Check file has content
	if info.Size() == 0 {
		return fmt.Errorf("moby data file is empty: %s", m.path)
	}

	// Basic content check - try to open and read first line
	file, err := os.Open(m.path)
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

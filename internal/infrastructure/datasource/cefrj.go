package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

const (
	cefrjURL      = "https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv"
	cefrjFilename = "cefrj-vocabulary-profile-1.5.csv"
)

// CEFRJSource manages the CEFR-J vocabulary profile CSV data source.
type CEFRJSource struct {
	path       string
	logger     *slog.Logger
	downloader *Downloader
}

// NewCEFRJSource creates a new CEFR-J data source.
func NewCEFRJSource(dataDir string, downloader *Downloader, logger *slog.Logger) *CEFRJSource {
	return &CEFRJSource{
		path:       filepath.Join(dataDir, "cefrj", cefrjFilename),
		logger:     logger,
		downloader: downloader,
	}
}

func (s *CEFRJSource) Name() string {
	return "CEFRJ"
}

func (s *CEFRJSource) Path() string {
	return s.path
}

func (s *CEFRJSource) DownloadURL() string {
	return cefrjURL
}

func (s *CEFRJSource) Exists() bool {
	info, err := os.Stat(s.path)
	if err != nil {
		return false
	}
	return !info.IsDir() && info.Size() > 0
}

func (s *CEFRJSource) Download(ctx context.Context) error {
	if err := s.downloader.DownloadFile(ctx, DownloadRequest{
		Source: s.Name(),
		URL:    s.DownloadURL(),
	}, s.path, ".cefrj-*"); err != nil {
		return fmt.Errorf("copy cache to destination: %w", err)
	}

	if err := s.Verify(); err != nil {
		_ = os.Remove(s.path)
		return fmt.Errorf("verify download: %w", err)
	}

	if s.logger != nil {
		s.logger.Info("cefrj source downloaded", "path", s.path)
	}
	return nil
}

func (s *CEFRJSource) Verify() error {
	info, err := os.Stat(s.path)
	if err != nil {
		return fmt.Errorf("cefrj data file not found: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("cefrj path is a directory, expected file: %s", s.path)
	}
	if info.Size() == 0 {
		return fmt.Errorf("cefrj data file is empty: %s", s.path)
	}
	return nil
}

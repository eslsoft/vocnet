package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

const (
	cefrjRawBaseURL     = "https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/refs/heads/master/"
	cefrjFileCacheGlobs = ".cefrj-*"
)

var cefrjArtifactFilenames = []string{
	"cefrj-vocabulary-profile-1.5.csv",
	"octanove-vocabulary-profile-c1c2-1.0.csv",
}

// CEFRJSource manages the CEFR-J vocabulary profile CSV data source.
type CEFRJSource struct {
	paths      []string
	logger     *slog.Logger
	downloader *Downloader
}

// NewCEFRJSource creates a new CEFR-J data source.
func NewCEFRJSource(dataDir string, downloader *Downloader, logger *slog.Logger) *CEFRJSource {
	paths := make([]string, 0, len(cefrjArtifactFilenames))
	for _, filename := range cefrjArtifactFilenames {
		paths = append(paths, filepath.Join(dataDir, "cefrj", filename))
	}

	return &CEFRJSource{
		paths:      paths,
		logger:     logger,
		downloader: downloader,
	}
}

func (s *CEFRJSource) Name() string {
	return "CEFRJ"
}

func (s *CEFRJSource) Path() string {
	return s.paths[0]
}

func (s *CEFRJSource) DownloadURL() string {
	return buildCEFRJArtifactURL(cefrjArtifactFilenames[0])
}

func (s *CEFRJSource) Exists() bool {
	for _, path := range s.paths {
		if !fileExistsWithData(path) {
			return false
		}
	}
	return true
}

func (s *CEFRJSource) Download(ctx context.Context) error {
	for i, filename := range cefrjArtifactFilenames {
		path := s.paths[i]
		if err := s.downloader.DownloadFile(ctx, DownloadRequest{
			Source: s.Name(),
			URL:    buildCEFRJArtifactURL(filename),
		}, path, cefrjFileCacheGlobs); err != nil {
			return fmt.Errorf("copy cache to destination for %s: %w", filepath.Base(path), err)
		}
	}

	if err := s.Verify(); err != nil {
		for _, path := range s.paths {
			_ = os.Remove(path)
		}
		return fmt.Errorf("verify download: %w", err)
	}

	if s.logger != nil {
		s.logger.Info("cefrj source downloaded", "path", s.Path())
	}
	return nil
}

func (s *CEFRJSource) Verify() error {
	for _, path := range s.paths {
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("cefrj data file not found (%s): %w", filepath.Base(path), err)
		}
		if info.IsDir() {
			return fmt.Errorf("cefrj path is a directory, expected file: %s", path)
		}
		if info.Size() == 0 {
			return fmt.Errorf("cefrj data file is empty: %s", path)
		}
	}
	return nil
}

func fileExistsWithData(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir() && info.Size() > 0
}

func buildCEFRJArtifactURL(filename string) string {
	return cefrjRawBaseURL + filename
}

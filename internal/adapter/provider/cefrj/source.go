package cefrj

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
)

const (
	cefrjRawBaseURL     = "https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/refs/heads/master/"
	cefrjFileCacheGlobs = ".cefrj-*"
)

var cefrjArtifactFilenames = []string{
	"cefrj-vocabulary-profile-1.5.csv",
	"octanove-vocabulary-profile-c1c2-1.0.csv",
}

// Source manages the CEFR-J vocabulary profile CSV data source.
type Source struct {
	paths      []string
	logger     *slog.Logger
	downloader *datasource.Downloader
}

// DataDir returns the CEFR-J directory under fixed datasource layout.
func DataDir(dataDir string) string {
	return filepath.Join(dataDir, "datasources", "cefrj")
}

func cefrjDataPaths(dataDir string) []string {
	baseDir := DataDir(dataDir)
	paths := make([]string, 0, len(cefrjArtifactFilenames))
	for _, filename := range cefrjArtifactFilenames {
		paths = append(paths, filepath.Join(baseDir, filename))
	}
	return paths
}

// NewSource creates a new CEFR-J data source.
func NewSource(dataDir string, downloader *datasource.Downloader, logger *slog.Logger) *Source {
	return &Source{
		paths:      cefrjDataPaths(dataDir),
		logger:     logger,
		downloader: downloader,
	}
}

func (s *Source) Name() string {
	return "cefrj"
}

func (s *Source) Path() string {
	return s.paths[0]
}

func (s *Source) DownloadURL() string {
	return buildCEFRJArtifactURL(cefrjArtifactFilenames[0])
}

func (s *Source) Exists() bool {
	for _, path := range s.paths {
		if !fileExistsWithData(path) {
			return false
		}
	}
	return true
}

func (s *Source) Download(ctx context.Context) error {
	for i, filename := range cefrjArtifactFilenames {
		path := s.paths[i]
		if err := s.downloader.DownloadFile(ctx, datasource.DownloadRequest{
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

func (s *Source) Verify() error {
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

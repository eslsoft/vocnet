package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/eslsoft/vocnet/internal/adapter/provider/contrib"
)

// ContribDataSource wraps a contrib source provider to implement the DataSource interface.
// This allows contrib sources (Python scripts) to handle their own data downloads.
type ContribDataSource struct {
	name       string
	execPath   string
	dataDir    string
	cacheDir   string
	logger     *slog.Logger
	downloader *Downloader
}

// NewContribDataSource creates a new contrib-based data source.
func NewContribDataSource(name, execPath, dataDir string, downloader *Downloader, logger *slog.Logger) *ContribDataSource {
	return &ContribDataSource{
		name:       name,
		execPath:   execPath,
		dataDir:    dataDir,
		cacheDir:   downloader.cacheDir,
		logger:     logger,
		downloader: downloader,
	}
}

func (s *ContribDataSource) Name() string {
	return s.name
}

func (s *ContribDataSource) Path() string {
	// The contrib source manages its own path, so we return the data dir
	return filepath.Join(s.dataDir, "datasources", s.name)
}

func (s *ContribDataSource) DownloadURL() string {
	// Contrib sources manage their own URLs
	return ""
}

func (s *ContribDataSource) Exists() bool {
	// Delegate to the contrib source's verify logic
	// We'll check by attempting to initialize the source
	ctx := context.Background()
	provider, err := s.createProvider(ctx)
	if err != nil {
		return false
	}
	defer func() { _ = provider.Close() }()

	// If initialization succeeds, the source likely has its data
	return true
}

func (s *ContribDataSource) Download(ctx context.Context) error {
	s.logger.Info("downloading via contrib source", "name", s.name)

	// Create provider
	provider, err := s.createProvider(ctx)
	if err != nil {
		return fmt.Errorf("create provider: %w", err)
	}
	defer func() { _ = provider.Close() }()

	// Call download method via JSON-RPC
	var result DownloadResult
	if err := provider.Call(ctx, "download", map[string]any{}, &result); err != nil {
		return fmt.Errorf("download call: %w", err)
	}

	s.logger.Info("download completed",
		"name", s.name,
		"status", result.Status,
	)

	return nil
}

func (s *ContribDataSource) Verify() error {
	// Try to initialize the provider
	ctx := context.Background()
	provider, err := s.createProvider(ctx)
	if err != nil {
		return fmt.Errorf("initialize provider: %w", err)
	}
	defer func() { _ = provider.Close() }()

	return nil
}

func (s *ContribDataSource) createProvider(ctx context.Context) (*contrib.ProcessSourceProvider, error) {
	// Set environment variables for the contrib source
	cmd := exec.CommandContext(ctx, s.execPath)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("PIPELINE_DATA_DIR=%s", s.dataDir),
		fmt.Sprintf("PIPELINE_CACHE_DIR=%s", s.cacheDir),
	)

	return contrib.NewProcessSourceProviderWithCmd(ctx, cmd, s.logger)
}

// DownloadResult is the response from contrib source download method.
type DownloadResult struct {
	Status   string `json:"status"`
	Path     string `json:"path,omitempty"`
	CSVPath  string `json:"csv_path,omitempty"`
	DBPath   string `json:"db_path,omitempty"`
	Size     int64  `json:"size,omitempty"`
	CSVSize  int64  `json:"csv_size,omitempty"`
	DBSize   int64  `json:"db_size,omitempty"`
}

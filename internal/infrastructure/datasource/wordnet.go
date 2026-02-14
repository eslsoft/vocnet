package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
)

// WordNetSource implements DataSource for NLTK-based WordNet via contrib source
// This no longer requires manual data downloads as NLTK handles WordNet data automatically
type WordNetSource struct {
	path   string
	logger *slog.Logger
}

// NewWordNetSource creates a new WordNet data source that uses NLTK
func NewWordNetSource(dataDir string, downloader *Downloader, logger *slog.Logger) *WordNetSource {
	return &WordNetSource{
		path:   filepath.Join("contrib", "sources", "wordnet"),
		logger: logger,
	}
}

func (s *WordNetSource) Name() string {
	return "WordNet"
}

func (s *WordNetSource) Path() string {
	return s.path
}

func (s *WordNetSource) DownloadURL() string {
	return "" // No download needed - NLTK handles WordNet data
}

func (s *WordNetSource) Exists() bool {
	// Check if uv and the wordnet contrib script exist
	if _, err := exec.LookPath("uv"); err != nil {
		s.logger.Debug("uv not found in PATH", "error", err)
		return false
	}

	// Check if the contrib script exists
	if _, err := os.Stat(s.path); err != nil {
		s.logger.Debug("wordnet contrib script not found", "path", s.path, "error", err)
		return false
	}

	return true
}

func (s *WordNetSource) Download(ctx context.Context) error {
	return fmt.Errorf("WordNet no longer requires manual download - it uses NLTK which auto-downloads data. Please ensure 'uv' is installed and available in PATH")
}

func (s *WordNetSource) Verify() error {
	if !s.Exists() {
		return fmt.Errorf("WordNet contrib source not available - ensure 'uv' is installed and wordnet contrib script exists at %s", s.path)
	}

	// Quick test that contrib script is executable and has basic dependencies
	cmd := exec.Command("bash", "-c", "echo '{\"jsonrpc\": \"2.0\", \"method\": \"initialize\", \"id\": 1}' | timeout 10s "+s.path)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to verify WordNet contrib source: %w (ensure uv and nltk are available)", err)
	}

	return nil
}

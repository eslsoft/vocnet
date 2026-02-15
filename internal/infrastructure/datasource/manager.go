package datasource

import (
	"context"
	"fmt"
	"log/slog"
)

// DataSource represents a pipeline data source with download capabilities
type DataSource interface {
	Name() string        // "wikidata", "moby", "cefrj"
	Path() string        // Resolved file/directory path
	DownloadURL() string // Source URL for download
	Exists() bool        // Check if file/dir exists
	Download(ctx context.Context) error
	Verify() error // Verify integrity after download
}

// Manager manages pipeline data sources
type Manager struct {
	sources map[string]DataSource
	logger  *slog.Logger
}

// NewManager creates a new data source manager.
func NewManager(logger *slog.Logger) *Manager {
	return &Manager{
		sources: make(map[string]DataSource),
		logger:  logger,
	}
}

// Register adds a data source to the manager.
func (m *Manager) Register(source DataSource) {
	m.sources[source.Name()] = source
}

// EnsureAvailable checks if required data sources are available, auto-downloading any that are missing.
func (m *Manager) EnsureAvailable(ctx context.Context, required ...string) error {
	// If no specific sources required, check all
	if len(required) == 0 {
		for key := range m.sources {
			required = append(required, key)
		}
	}

	m.logger.Debug("checking data source availability", "sources", required)

	for _, name := range required {
		source, ok := m.sources[name]
		if !ok {
			return fmt.Errorf("unknown data source: %s", name)
		}

		if source.Exists() {
			if err := source.Verify(); err == nil {
				continue
			} else {
				m.logger.Warn("data source verification failed, will re-download", "name", name, "error", err)
			}
		}

		m.logger.Info("downloading missing data source", "name", name)
		if err := source.Download(ctx); err != nil {
			return fmt.Errorf("auto-download failed for %s: %w", name, err)
		}
		m.logger.Info("download completed", "name", name)
	}

	m.logger.Debug("all data sources available", "count", len(required))
	return nil
}

package datasource

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"

	"github.com/eslsoft/vocnet/internal/infrastructure/config"
)

// DataSource represents a pipeline data source with download capabilities
type DataSource interface {
	Name() string        // "ConceptNet", "ECDICT", "WordNet"
	Path() string        // Resolved file/directory path
	DownloadURL() string // Source URL for download
	Exists() bool        // Check if file/dir exists
	Download(ctx context.Context) error
	Verify() error // Verify integrity after download
}

// DataPaths holds resolved paths for all pipeline data sources.
type DataPaths struct {
	ConceptNet string
	ECDICT     string
	WordNet    string
	Moby       string
	Wikidata   string
	CEFRJ      string
}

// ResolvePaths computes all data source paths from a base directory.
func ResolvePaths(dataDir string) DataPaths {
	return DataPaths{
		ConceptNet: filepath.Join(dataDir, "conceptnet", conceptNetFilename),
		ECDICT:     filepath.Join(dataDir, "ecdict", ecdictDefaultFilename),
		WordNet:    filepath.Join(dataDir, "wordnet"),
		Moby:       filepath.Join(dataDir, "moby", mobyFilename),
		Wikidata:   filepath.Join(dataDir, "wikidata", wikidataLexemesFilename),
		CEFRJ:      filepath.Join(dataDir, "cefrj"),
	}
}

// Status represents the status of a data source
type Status struct {
	Name      string
	Path      string
	Exists    bool
	Size      int64  // Size in bytes, 0 if directory or not applicable
	ErrorMsg  string // Error message if any issue
	Available bool   // True if exists and verified
}

// Manager manages pipeline data sources
type Manager struct {
	sources  map[string]DataSource
	config   *config.Config
	logger   *slog.Logger
	cacheDir string
}

// NewManager creates a new data source manager
func NewManager(cfg *config.Config, logger *slog.Logger, cacheDir string) *Manager {
	m := &Manager{
		sources:  make(map[string]DataSource),
		config:   cfg,
		logger:   logger,
		cacheDir: cacheDir,
	}

	dataDir := cfg.Pipeline.DataDir
	downloader := NewDownloader(cacheDir, logger)

	// Register data sources
	m.sources["conceptnet"] = NewConceptNetSource(dataDir, downloader, logger)
	m.sources["ecdict"] = NewECDICTSource(dataDir, downloader, logger)
	m.sources["wordnet"] = NewWordNetSource(dataDir, downloader, logger)
	m.sources["moby"] = NewMobySource(dataDir, downloader, logger)
	m.sources["wikidata"] = NewWikidataSource(dataDir, downloader, logger)
	m.sources["cefrj"] = NewCEFRJSource(dataDir, downloader, logger)

	return m
}

// CheckAll returns the status of all registered data sources
func (m *Manager) CheckAll() ([]Status, error) {
	statuses := make([]Status, 0, len(m.sources))

	for _, source := range m.sources {
		status := Status{
			Name:   source.Name(),
			Path:   source.Path(),
			Exists: source.Exists(),
		}

		if status.Exists {
			if err := source.Verify(); err != nil {
				status.ErrorMsg = err.Error()
				status.Available = false
			} else {
				status.Available = true
			}
		} else {
			status.Available = false
		}

		statuses = append(statuses, status)
	}

	return statuses, nil
}

// DownloadMissing downloads all missing data sources
func (m *Manager) DownloadMissing(ctx context.Context) error {
	statuses, err := m.CheckAll()
	if err != nil {
		return fmt.Errorf("check data sources: %w", err)
	}

	var hasError bool
	for _, status := range statuses {
		if !status.Available {
			source := m.sources[toSourceKey(status.Name)]
			m.logger.Info("downloading missing data source", "name", status.Name)
			if err := source.Download(ctx); err != nil {
				m.logger.Error("download failed", "name", status.Name, "error", err)
				hasError = true
				continue
			}
			m.logger.Info("download completed", "name", status.Name)
		}
	}

	if hasError {
		return fmt.Errorf("some downloads failed")
	}

	return nil
}

// DownloadSource downloads a specific data source by name
func (m *Manager) DownloadSource(ctx context.Context, name string) error {
	source, ok := m.sources[name]
	if !ok {
		return fmt.Errorf("unknown data source: %s", name)
	}

	m.logger.Info("downloading data source", "name", source.Name())
	if err := source.Download(ctx); err != nil {
		return fmt.Errorf("download %s: %w", source.Name(), err)
	}

	m.logger.Info("download completed", "name", source.Name())
	return nil
}

// EnsureAvailable checks if required data sources are available, optionally auto-downloading them
func (m *Manager) EnsureAvailable(ctx context.Context, autoDownload bool, required ...string) error {
	// If no specific sources required, check all
	if len(required) == 0 {
		for key := range m.sources {
			required = append(required, key)
		}
	}

	var missing []string
	for _, name := range required {
		source, ok := m.sources[name]
		if !ok {
			return fmt.Errorf("unknown data source: %s", name)
		}

		if !source.Exists() {
			missing = append(missing, name)
			continue
		}

		if err := source.Verify(); err != nil {
			missing = append(missing, name)
		}
	}

	if len(missing) == 0 {
		return nil
	}

	// If auto-download is enabled, download missing sources
	if autoDownload {
		for _, name := range missing {
			if err := m.DownloadSource(ctx, name); err != nil {
				return fmt.Errorf("auto-download failed for %s: %w", name, err)
			}
		}
		return nil
	}

	// Otherwise, return error with helpful message
	return fmt.Errorf("missing data sources: %v. Run 'vocnet pipeline source download' to download them", missing)
}

// ListSources returns all registered data source names
func (m *Manager) ListSources() []string {
	names := make([]string, 0, len(m.sources))
	for key := range m.sources {
		names = append(names, key)
	}
	return names
}

// toSourceKey normalizes source name to key (lowercase)
func toSourceKey(name string) string {
	switch name {
	case "ConceptNet":
		return "conceptnet"
	case "ECDICT":
		return "ecdict"
	case "WordNet":
		return "wordnet"
	case "Moby":
		return "moby"
	case "Wikidata":
		return "wikidata"
	case "CEFRJ":
		return "cefrj"
	default:
		return name
	}
}

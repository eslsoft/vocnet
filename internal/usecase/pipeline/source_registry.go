package pipeline

import (
	"log/slog"

	"github.com/eslsoft/vocnet/internal/repository"
)

// SourceRegistry manages the collection of SourceProviders.
type SourceRegistry struct {
	sources []repository.SourceProvider
	logger  *slog.Logger
}

// NewSourceRegistry creates a new SourceRegistry.
func NewSourceRegistry(logger *slog.Logger) *SourceRegistry {
	return &SourceRegistry{logger: logger}
}

// Register adds a SourceProvider to the registry.
func (r *SourceRegistry) Register(source repository.SourceProvider) {
	r.sources = append(r.sources, source)
	m := source.Manifest()
	r.logger.Debug("registered source provider",
		"name", m.Name,
		"kind", m.Kind,
	)
}

// Sources returns all registered SourceProviders.
func (r *SourceRegistry) Sources() []repository.SourceProvider {
	return r.sources
}

// CloseAll closes all registered source providers.
func (r *SourceRegistry) CloseAll() {
	for _, src := range r.sources {
		if err := src.Close(); err != nil {
			r.logger.Warn("failed to close source provider", "name", src.Manifest().Name, "error", err)
		}
	}
}

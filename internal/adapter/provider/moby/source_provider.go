package moby

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// SourceProvider wraps a Moby Reader as a unified SourceProvider.
type SourceProvider struct {
	reader *Reader
}

// NewSourceProvider creates a SourceProvider backed by the given Reader.
func NewSourceProvider(reader *Reader) *SourceProvider {
	return &SourceProvider{reader: reader}
}

func (p *SourceProvider) Manifest() repository.SourceManifest {
	return repository.SourceManifest{
		Name:         "moby",
		Version:      "1.0.0",
		Kind:         repository.SourceKindBuiltin,
		Languages:    []string{"en"},
		Capabilities: []repository.SourceCapability{repository.CapabilityForms},
		Stage:        "lexical",
	}
}

func (p *SourceProvider) Lookup(ctx context.Context, query repository.SourceQuery) (*repository.SourceResult, error) {
	if query.Context == nil || len(query.Context.Forms) == 0 {
		return nil, nil
	}

	var updatedForms []*entity.LemmaForm
	for _, form := range query.Context.Forms {
		syllables, err := p.reader.Lookup(ctx, form.Surface)
		if err != nil || len(syllables) == 0 {
			continue
		}

		updated := *form
		updated.Syllables = syllables
		updatedForms = append(updatedForms, &updated)
	}

	if len(updatedForms) == 0 {
		return nil, nil
	}

	return &repository.SourceResult{
		Forms: updatedForms,
	}, nil
}

func (p *SourceProvider) Close() error {
	return p.reader.Close()
}

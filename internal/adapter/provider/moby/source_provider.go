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
	}
}

func (p *SourceProvider) Lookup(ctx context.Context, query repository.SourceQuery) (*repository.SourceResult, error) {
	syllables, err := p.reader.Lookup(ctx, query.Term)
	if err != nil || len(syllables) == 0 {
		return nil, nil
	}

	form := &entity.LemmaForm{
		Surface:   query.Term,
		FormType:  entity.FormTypeLemma,
		Syllables: syllables,
	}

	return &repository.SourceResult{
		Forms: []*entity.LemmaForm{form},
	}, nil
}

func (p *SourceProvider) Close() error {
	return p.reader.Close()
}

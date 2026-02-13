package cefrj

import (
	"context"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// SourceProvider wraps a CEFRJ Reader as a unified SourceProvider.
type SourceProvider struct {
	reader *Reader
}

// NewSourceProvider creates a SourceProvider backed by the given Reader.
func NewSourceProvider(reader *Reader) *SourceProvider {
	return &SourceProvider{reader: reader}
}

func (p *SourceProvider) Manifest() repository.SourceManifest {
	return repository.SourceManifest{
		Name:         "cefrj",
		Version:      "1.5.0",
		Kind:         repository.SourceKindBuiltin,
		Languages:    []string{"en"},
		Capabilities: []repository.SourceCapability{repository.CapabilityMetadata},
		Stage:        "lexical",
	}
}

func (p *SourceProvider) Lookup(ctx context.Context, query repository.SourceQuery) (*repository.SourceResult, error) {
	if query.Context == nil || query.Context.Lemma == nil {
		return nil, nil
	}

	entry, err := p.reader.Lookup(ctx, query.Term)
	if err != nil {
		return nil, err
	}
	if entry == nil || entry.MinLevel == "" {
		return nil, nil
	}

	updated := *query.Context.Lemma
	if updated.Level == "" {
		updated.Level = entry.MinLevel
	} else {
		updated.Level = minCEFRLevel(updated.Level, entry.MinLevel)
	}

	evidence := &entity.RawEvidence{
		Provider:      "cefrj",
		Phase:         int32(entity.PhaseLexical),
		Content:       buildEvidence(entry),
		SchemaVersion: "cefrj-1.5+c1c2-1.0",
		FetchedAt:     time.Now(),
	}

	return &repository.SourceResult{
		Evidence:    []*entity.RawEvidence{evidence},
		LemmaUpdate: &updated,
	}, nil
}

func (p *SourceProvider) Close() error {
	return nil
}

func minCEFRLevel(a, b string) string {
	a = strings.ToUpper(strings.TrimSpace(a))
	b = strings.ToUpper(strings.TrimSpace(b))
	order := map[string]int{"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
	av, aok := order[a]
	bv, bok := order[b]
	switch {
	case !aok:
		return b
	case !bok:
		return a
	case av <= bv:
		return a
	default:
		return b
	}
}

func buildEvidence(entry *Entry) map[string]any {
	levelsByPOS := make(map[string]any, len(entry.LevelsByPOS))
	for pos, lv := range entry.LevelsByPOS {
		levelsByPOS[pos] = lv
	}

	matchedForms := make([]any, 0, len(entry.MatchedForms))
	for _, f := range entry.MatchedForms {
		matchedForms = append(matchedForms, f)
	}

	return map[string]any{
		"headword":      entry.Headword,
		"min_level":     entry.MinLevel,
		"levels_by_pos": levelsByPOS,
		"matched_forms": matchedForms,
	}
}

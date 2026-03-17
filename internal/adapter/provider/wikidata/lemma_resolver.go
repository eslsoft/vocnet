package wikidata

import (
	"context"
	"strings"
)

// LemmaResolver resolves a term to its Wikidata lemma surfaces.
type LemmaResolver struct {
	reader *Reader
}

// NewLemmaResolver creates a resolver backed by the Wikidata indexed reader.
func NewLemmaResolver(reader *Reader) *LemmaResolver {
	return &LemmaResolver{reader: reader}
}

// ResolveLemmas returns all unique Wikidata lemma surfaces for lexemes
// that have the given term as a form or lemma. Affix entries (e.g., "-ate")
// are excluded.
func (r *LemmaResolver) ResolveLemmas(ctx context.Context, term string, language string) ([]string, error) {
	lexemes, _, err := r.reader.FetchLexemes(ctx, term, language)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	var lemmas []string
	for _, lex := range lexemes {
		lemma := strings.TrimSpace(lex.Lemma)
		if lemma == "" || strings.HasPrefix(lemma, "-") {
			continue
		}
		key := strings.ToLower(lemma)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		lemmas = append(lemmas, lemma)
	}

	return lemmas, nil
}

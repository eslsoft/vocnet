package provider

import (
	"context"
)

// WikidataLexeme represents a Wikidata lexeme with its senses and forms.
type WikidataLexeme struct {
	LexemeID string // e.g. "L123456"
	Lemma    string // headword / lemma representation (e.g. "limit", "run")
	Language string
	POS      string
	Variants []string // spelling variants (e.g. en-us vs en-gb)
	Senses   []WikidataSense
	Forms    []WikidataForm
}

// WikidataSense is a single sense from a Wikidata lexeme.
type WikidataSense struct {
	SenseID string
	Glosses map[string]string // language -> gloss
}

// WikidataForm is a form from a Wikidata lexeme.
type WikidataForm struct {
	FormID         string
	Representation string
	Features       []string // grammatical features as QIDs
	Phonetics      []WikidataPhonetic
}

// WikidataPhonetic represents pronunciation data from Wikidata.
type WikidataPhonetic struct {
	IPA     string
	Dialect string // e.g., "US", "UK", "RP", etc.
}

// WikidataProvider fetches lexeme data from Wikidata.
type WikidataProvider interface {
	FetchLexemes(ctx context.Context, term string, language string) ([]WikidataLexeme, map[string]any, error)
}

// ConceptNetEdge represents an edge from the ConceptNet API.
type ConceptNetEdge struct {
	RelationType  string
	StartTerm     string
	StartLanguage string
	EndTerm       string
	EndLanguage   string
	Weight        float64
	SurfaceText   string
}

// ConceptNetProvider fetches relation data from ConceptNet.
type ConceptNetProvider interface {
	FetchRelations(ctx context.Context, term string, language string) ([]ConceptNetEdge, map[string]any, error)
}

// ClosableConceptNetProvider is an optional extension of ConceptNetProvider
// for implementations that require resource cleanup.
type ClosableConceptNetProvider interface {
	ConceptNetProvider
	Close() error
}

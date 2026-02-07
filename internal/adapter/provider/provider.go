package provider

import (
	"context"
)

// WikidataEntity represents a Wikidata entity search result.
type WikidataEntity struct {
	QID         string
	Label       string
	Description string
}

// WikidataLexeme represents a Wikidata lexeme with its senses and forms.
type WikidataLexeme struct {
	LexemeID string // e.g. "L123456"
	Language string
	POS      string
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
}

// WikidataProvider fetches lexeme data from Wikidata.
type WikidataProvider interface {
	SearchEntity(ctx context.Context, term string, language string) (*WikidataEntity, error)
	FetchLexemes(ctx context.Context, term string, language string) ([]WikidataLexeme, map[string]any, error)
}

// ConceptNetEdge represents an edge from the ConceptNet API.
type ConceptNetEdge struct {
	RelationType string
	StartTerm    string
	EndTerm      string
	Weight       float64
	SurfaceText  string
}

// ConceptNetProvider fetches relation data from ConceptNet.
type ConceptNetProvider interface {
	FetchRelations(ctx context.Context, term string, language string) ([]ConceptNetEdge, map[string]any, error)
}

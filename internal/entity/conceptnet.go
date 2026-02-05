package entity

import "time"

// Concept represents a ConceptNet node.
type Concept struct {
	ID           int64
	ConceptnetID string
	Language     string
	Label        string
	Normalized   string
	Pos          string
	Sense        string

	CreatedAt time.Time
	UpdatedAt time.Time
}

// ConceptEdge represents a directed ConceptNet edge.
type ConceptEdge struct {
	ID        int64
	Relation  string
	Weight    float64
	SourceID  int64
	TargetID  int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

// LexemeConceptLink links a lexeme to a ConceptNet node.
type LexemeConceptLink struct {
	ID         int64
	LexemeID   int64
	ConceptID  int64
	MatchType  string
	Confidence float64
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

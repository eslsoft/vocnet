package entity

import "time"

// RelationType constants for semantic relations between lexemes.
const (
	RelationSynonym     = "SYNONYM"
	RelationAntonym     = "ANTONYM"
	RelationHypernym    = "HYPERNYM"
	RelationHyponym     = "HYPONYM"
	RelationAssociation = "ASSOCIATION"
	RelationCauseEffect = "CAUSE_EFFECT"
	RelationPartWhole   = "PART_WHOLE"
	RelationDerivative  = "DERIVATIVE"
)

// SemanticRelation links two lexemes with a typed semantic relationship.
type SemanticRelation struct {
	ID             int64
	SourceLexemeID int64
	TargetLexemeID *int64 // nil = unresolved
	TargetTerm     string // always set, display text
	RelationType   string
	Provider       string  // "wordnet", "conceptnet", "ecdict", "llm", "manual"
	Strength       float64 // 0.0-1.0
	SenseMapped    bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

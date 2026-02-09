package entity

import "time"

// RelationType constants for semantic relations between lexemes.
const (
	RelationSynonym     = "SYNONYM"
	RelationAntonym     = "ANTONYM"
	RelationHypernym    = "HYPERNYM" // is-a (parent/superordinate)
	RelationHyponym     = "HYPONYM"  // is-a (child/subordinate)
	RelationAssociation = "ASSOCIATION"
	RelationCauseEffect = "CAUSE_EFFECT"
	RelationPartWhole   = "PART_WHOLE"
	RelationDerivative  = "DERIVATIVE"

	// WordNet-specific relations
	RelationMemberHolonym  = "MEMBER_HOLONYM"  // X is a member of Y
	RelationPartHolonym    = "PART_HOLONYM"    // X is a part of Y
	RelationMemberMeronym  = "MEMBER_MERONYM"  // Y has member X
	RelationPartMeronym    = "PART_MERONYM"    // Y has part X
	RelationAttribute      = "ATTRIBUTE"       // attribute relation
	RelationSimilar        = "SIMILAR"         // similar to
	RelationParticipleOf   = "PARTICIPLE_OF"   // verb participle form
	RelationDerivedFrom    = "DERIVED_FROM"    // derived/related form
	RelationCategory       = "CATEGORY"        // domain category
	RelationCategoryMember = "CATEGORY_MEMBER" // member of domain category
)

// SemanticRelation links two lexemes with a typed semantic relationship.
type SemanticRelation struct {
	ID               int64
	SourceLexemeID   int64  // DB foreign key, set by persistence layer
	SourceExternalID string // Wikidata ExternalID, set by processors
	TargetLexemeID   *int64 // nil = unresolved
	TargetRef        string // stable target URI, e.g. wikidata://lexeme/L123
	TargetTerm       string // always set, display text
	RelationType     string
	Provider         string  // "wordnet", "conceptnet", "ecdict", "llm", "manual"
	Strength         float64 // 0.0-1.0
	SenseMapped      bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

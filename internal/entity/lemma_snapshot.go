package entity

import "time"

// QualityScore captures multi-dimensional quality metrics for a lemma snapshot.
type QualityScore struct {
	Overall      float64 `json:"overall"`
	Completeness float64 `json:"completeness"`
	Depth        float64 `json:"depth"`
	Density      float64 `json:"density"`
	Validity     float64 `json:"validity"`
}

// LemmaSnapshotSense represents a single definition/gloss within a snapshot.
type LemmaSnapshotSense struct {
	Language    string   `json:"language"`
	Gloss       string   `json:"gloss"`
	Examples    []string `json:"examples,omitempty"`
	Provider    string   `json:"provider,omitempty"`
	TrustWeight float64  `json:"trust_weight,omitempty"`
}

// LemmaSnapshotForm represents an inflected form within a snapshot.
type LemmaSnapshotForm struct {
	Surface     string `json:"surface"`
	FormType    string `json:"form_type"`
	IsIrregular bool   `json:"is_irregular,omitempty"`
}

// LemmaSnapshotLexeme represents a POS-grouped lexeme entry within a snapshot.
type LemmaSnapshotLexeme struct {
	POS       string               `json:"pos"`
	Senses    []LemmaSnapshotSense `json:"senses,omitempty"`
	Forms     []LemmaSnapshotForm  `json:"forms,omitempty"`
	Phonetics []Phonetic           `json:"phonetics,omitempty"`
}

// LemmaSnapshotRelation represents a semantic relation within a snapshot.
type LemmaSnapshotRelation struct {
	RelationType   string  `json:"relation_type"`
	TargetTerm     string  `json:"target_term"`
	TargetRef      string  `json:"target_ref,omitempty"`
	Provider       string  `json:"provider"`
	Strength       float64 `json:"strength"`
	SenseMapped    bool    `json:"sense_mapped,omitempty"`
	TargetResolved bool    `json:"target_resolved,omitempty"`
}

// LemmaSnapshotData is the self-contained materialized snapshot payload stored as JSON.
type LemmaSnapshotData struct {
	Lexemes     []LemmaSnapshotLexeme   `json:"lexemes,omitempty"`
	Frequencies []Frequency             `json:"frequencies,omitempty"`
	Relations   []LemmaSnapshotRelation `json:"relations,omitempty"`
}

// LemmaSnapshot is the materialized, self-contained view of a lemma's knowledge.
type LemmaSnapshot struct {
	ID            int64
	LemmaID       int64
	JobID         *int64
	Surface       string
	Normalized    string
	LookupTerms   []string
	Language      string
	IsLatest      bool
	Version       int32
	SchemaVersion int32
	Payload       LemmaSnapshotData
	Quality       QualityScore
	LexemeCount   int32
	SenseCount    int32
	FormCount     int32
	RelationCount int32
	ProviderCount int32
	SynthesizedAt time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

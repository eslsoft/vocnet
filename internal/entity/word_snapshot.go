package entity

import "time"

// QualityScore captures multi-dimensional quality metrics for a word snapshot.
type QualityScore struct {
	Overall      float64 `json:"overall"`
	Completeness float64 `json:"completeness"`
	Depth        float64 `json:"depth"`
	Density      float64 `json:"density"`
	Validity     float64 `json:"validity"`
}

// SnapshotSense represents a single definition/gloss within a snapshot.
type SnapshotSense struct {
	Language    string   `json:"language"`
	Gloss       string   `json:"gloss"`
	Examples    []string `json:"examples,omitempty"`
	Provider    string   `json:"provider,omitempty"`
	TrustWeight float64  `json:"trust_weight,omitempty"`
}

// SnapshotForm represents an inflected form within a snapshot.
type SnapshotForm struct {
	Surface     string `json:"surface"`
	FormType    string `json:"form_type"`
	IsIrregular bool   `json:"is_irregular,omitempty"`
}

// SnapshotLexeme represents a POS-grouped lexeme entry within a snapshot.
type SnapshotLexeme struct {
	POS       string          `json:"pos"`
	Senses    []SnapshotSense `json:"senses,omitempty"`
	Forms     []SnapshotForm  `json:"forms,omitempty"`
	Phonetics []Phonetic      `json:"phonetics,omitempty"`
}

// SnapshotRelation represents a semantic relation within a snapshot.
type SnapshotRelation struct {
	RelationType string  `json:"relation_type"`
	TargetTerm   string  `json:"target_term"`
	TargetRef    string  `json:"target_ref,omitempty"`
	Provider     string  `json:"provider"`
	Strength     float64 `json:"strength"`
	SenseMapped  bool    `json:"sense_mapped,omitempty"`
	// TargetResolved indicates whether this relation resolved to an internal target lexeme.
	TargetResolved bool `json:"target_resolved,omitempty"`
}

// SnapshotData is the self-contained materialized snapshot stored as JSON.
type SnapshotData struct {
	Lexemes   []SnapshotLexeme   `json:"lexemes,omitempty"`
	Relations []SnapshotRelation `json:"relations,omitempty"`
}

// WordSnapshot is the materialized, self-contained view of a word's knowledge.
type WordSnapshot struct {
	ID                 int64
	LemmaID            int64
	JobID              *int64
	Term               string
	Terms              []string
	Language           string
	Latest             bool
	Version            int32
	Data               SnapshotData
	QScore             float64
	QScoreCompleteness float64
	QScoreDepth        float64
	QScoreDensity      float64
	QScoreValidity     float64
	SynthesizedAt      time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

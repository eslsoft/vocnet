package entity

import "time"

// RawEvidence stores a raw response envelope from an external data provider.
type RawEvidence struct {
	ID            int64
	LemmaID       int64
	Provider      string // "wikidata", "wordnet", "ecdict", "conceptnet", "llm", "manual"
	Phase         int32  // 1-5
	Content       map[string]any
	SchemaVersion string
	FetchedAt     time.Time
	CreatedAt     time.Time
}

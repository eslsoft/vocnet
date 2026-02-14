package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// SourceCapability declares what types of data a source can contribute.
type SourceCapability string

const (
	CapabilityLexemes    SourceCapability = "lexemes"    // Can produce Lexeme entities
	CapabilityForms      SourceCapability = "forms"      // Can produce LemmaForm entities
	CapabilityRelations  SourceCapability = "relations"  // Can produce SemanticRelation entities
	CapabilityEnrichment SourceCapability = "enrichment" // Can enrich existing entities (senses, phonetics, frequencies)
	CapabilityMetadata   SourceCapability = "metadata"   // Can produce lemma-level metadata (CEFR level, syllables)
)

// SourceKind indicates whether a source is compiled into the binary or external.
type SourceKind string

const (
	SourceKindBuiltin SourceKind = "builtin"
	SourceKindContrib SourceKind = "contrib"
)

// SourceManifest declares a source's identity and capabilities.
type SourceManifest struct {
	Name         string             // Unique identifier: "wikidata", "ecdict", "contrib/jmdict"
	Version      string             // Semantic version: "1.0.0"
	Kind         SourceKind         // builtin or contrib
	Languages    []string           // Supported languages: ["en"], ["en", "zh"], ["*"]
	Capabilities []SourceCapability // What this source can produce
}

// SourceQuery is the standardized input for all source lookups.
// Sources receive only term and language — they return raw data and
// the system (GenericSourceProcessor) decides how to merge it.
type SourceQuery struct {
	Term     string
	Language string
}

// SourceResult is the standardized output from all source lookups.
// Each source populates only the fields matching its capabilities.
// Sources return raw data without referencing pipeline context — the
// system (GenericSourceProcessor) handles merging into pipeline state.
type SourceResult struct {
	Lexemes       []*entity.Lexeme
	Forms         []*entity.LemmaForm
	Relations     []*entity.SemanticRelation
	LemmaUpdate   *entity.Lemma
	Evidence      []*entity.RawEvidence
	FormsByLexeme map[string][]*entity.LemmaForm
}

// SourceProvider is the unified interface for all data sources (builtin and contrib).
// Every source implements this contract. The pipeline does not need to know if data
// came from an in-process Go reader or an external JSON-RPC sidecar.
type SourceProvider interface {
	Manifest() SourceManifest
	Lookup(ctx context.Context, query SourceQuery) (*SourceResult, error)
	Close() error
}

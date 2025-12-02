package entity

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

// LearnedWord represents a user's personalised vocabulary entry.
// This is a word-level learning record (not lexeme-level), which simplifies
// the user experience for the majority of cases where multi-sense tracking is not needed.
type LearnedWord struct {
	ID            int64
	UserID        uuid.UUID
	Term          string // The term stored: lemma for regular forms, or the term itself for irregular forms
	CaseSensitive bool   // Whether this word requires case-sensitive matching (e.g., polish vs Polish)
	Language      Language
	Tags          []string
	Notes        []string
	Relations    []LearnedWordRelation
	Contexts     []LearnedWordContext // Context sentences where user encountered this word
	Mastery      MasteryBreakdown
	Review       ReviewTiming
	QueriedCount int64
	MatchedTerms []string // All query terms that matched this stored term
	CreatedBy    string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	// FUTURE: LexemeOverrides map[string]LexemeOverride
	// This will enable tracking mastery for specific word senses when needed.
	// Key: Wikidata Lexeme ID (e.g. "L123456")
	// Value: Lexeme-specific mastery, note, and optional form status
}

// MasteryBreakdown captures skill-specific mastery scores for a user word.
type MasteryBreakdown struct {
	Listen    int32
	Read      int32
	Spell     int32
	Pronounce int32
	Overall   int32
}

// ReviewTiming represents spaced repetition metadata for a user lexeme.
type ReviewTiming struct {
	LastReviewAt time.Time
	NextReviewAt time.Time
	IntervalDays int32
	FailCount    int32
}

// LearnedWordRelation links a user word to another concept in their vocabulary graph.
type LearnedWordRelation struct {
	Word         string    `json:"word"`
	RelationType int32     `json:"relation_type"`
	Note         string    `json:"note,omitempty"`
	CreatedBy    string    `json:"created_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// LearnedWordContext stores a sentence/context where user encountered the word.
type LearnedWordContext struct {
	Sentence    string    `json:"sentence"`     // The sentence containing the word
	Source      int32     `json:"source"`       // How this context was added (article, book, manual, etc.)
	SourceRef   string    `json:"source_ref"`   // Optional reference (article title, book name, URL, etc.)
	CollectedAt time.Time `json:"collected_at"` // When this context was collected
}

// Normalize ensures defaults & constraints before persistence.
func (uw *LearnedWord) Normalize(now time.Time) {
	uw.Term = strings.TrimSpace(uw.Term)
	if uw.CreatedAt.IsZero() {
		uw.CreatedAt = now
	}
	uw.UpdatedAt = now
	if uw.Language == "" {
		uw.Language = "en"
	}
	if uw.Relations == nil {
		uw.Relations = []LearnedWordRelation{}
	}
	if uw.Contexts == nil {
		uw.Contexts = []LearnedWordContext{}
	}
	if uw.Tags == nil {
		uw.Tags = []string{}
	}
}

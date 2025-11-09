package entity

import (
	"strings"
	"time"
)

// LearnedLexeme represents a user's personalised vocabulary entry.
type LearnedLexeme struct {
	ID          int64
	UserID      int64
	LexemeID    int64  // Current association to lexemes.id, nullable for migration
	LexemeLID   string // Stable identifier: {language}:{lemma}:{pos}
	DisplayTerm string
	Language    Language
	Tags        []string
	Note        string
	Relations   []LearnedLexemeRelation
	Mastery     MasteryBreakdown
	Review      ReviewTiming
	FormStatus  map[string]FormMastery
	QueryCount  int64
	CreatedBy   string
	CreatedAt   time.Time
	UpdatedAt   time.Time
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

// LearnedLexemeRelation links a user lexeme to another concept in their vocabulary graph.
type LearnedLexemeRelation struct {
	Word         string    `json:"word"`
	RelationType int32     `json:"relation_type"`
	Note         string    `json:"note,omitempty"`
	CreatedBy    string    `json:"created_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// FormMastery keeps track of mastery metrics for a specific lexeme form.
type FormMastery struct {
	FormID    string `json:"form_id"`
	Strength  int32  `json:"strength"`
	Exposure  int32  `json:"exposure"`
	UpdatedAt time.Time
}

// Normalize ensures defaults & constraints before persistence.
func (uw *LearnedLexeme) Normalize(now time.Time) {
	uw.LexemeLID = strings.TrimSpace(uw.LexemeLID)
	uw.DisplayTerm = strings.TrimSpace(uw.DisplayTerm)
	if uw.CreatedAt.IsZero() {
		uw.CreatedAt = now
	}
	uw.UpdatedAt = now
	if uw.Language == "" {
		uw.Language = "en"
	}
	if uw.Relations == nil {
		uw.Relations = []LearnedLexemeRelation{}
	}
	if uw.Tags == nil {
		uw.Tags = []string{}
	}
	if uw.FormStatus == nil {
		uw.FormStatus = map[string]FormMastery{}
	}
}

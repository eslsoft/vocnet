package entity

import (
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

// LearnedWord represents a user's personalised vocabulary entry.
// This is a word-level learning record (not lexeme-level), which simplifies
// the user experience for the majority of cases where multi-sense tracking is not needed.
type LearnedWord struct {
	ID       int64
	UserID   uuid.UUID
	Term     string // The term stored: lemma for regular forms, or the term itself for irregular forms
	Normal   string // Normalized lowercase form of term for case-insensitive querying
	Language Language
	Tags          []string
	Notes         []string
	Relations     []LearnedWordRelation
	Contexts      []LearnedWordContext // Context sentences where user encountered this word
	Mastery       MasteryBreakdown
	Review        ReviewTiming
	QueriedCount  int64
	CreatedAt     time.Time
	UpdatedAt     time.Time

	MatchedTerms []string // All query terms that matched this stored term

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

// MasteryLevel represents the user's current mastery state for a word.
type MasteryLevel int32

const (
	MasteryLevelUnspecified MasteryLevel = 0 // Not set (system default)
	MasteryLevelUnknown     MasteryLevel = 1 // Completely unfamiliar
	MasteryLevelRecognized  MasteryLevel = 2 // Seen before, can identify
	MasteryLevelUnderstood  MasteryLevel = 3 // Know the meaning
	MasteryLevelProficient  MasteryLevel = 4 // Can use actively
	MasteryLevelMastered    MasteryLevel = 5 // Fluent, automatic
)

// CalculateOverall computes the overall mastery score using weighted formula.
// Returns 0-500 (representing 0.0-5.0 with centpoints).
// Formula:
//   - Receptive (passive) = (Read + Listen) / 2.0
//   - Productive (active) = 0.3 * Spell + 0.7 * Pronounce (speaking weighted higher)
//   - Overall = round((0.6 * Receptive + 0.4 * Productive) * 100)
func (m MasteryBreakdown) CalculateOverall() int32 {
	// Receptive (passive): simple average of reading + listening
	receptive := float64(m.Read+m.Listen) / 2.0

	// Productive (active): weighted average, speaking (70%) > spelling (30%)
	productive := 0.3*float64(m.Spell) + 0.7*float64(m.Pronounce)

	// Overall: receptive (60%) + productive (40%)
	overallRaw := 0.6*receptive + 0.4*productive
	overall := int32(math.Round(overallRaw * 100))

	// Clamp to 0-500 range
	if overall < 0 {
		return 0
	}
	if overall > 500 {
		return 500
	}
	return overall
}

// CalculateMasteryLevel determines the mastery level based on the overall score.
// Returns one of: UNSPECIFIED, UNKNOWN, RECOGNIZED, UNDERSTOOD, PROFICIENT, or MASTERED.
//
// Thresholds are midpoints between adjacent InitializeFromUserMasteryLevel values:
//
//	overall == 0         → UNSPECIFIED
//	overall < 126        → UNKNOWN     (Level 1 init produces ~90)
//	overall 126-219      → RECOGNIZED  (Level 2 init produces ~162)
//	overall 220-312      → UNDERSTOOD  (Level 3 init produces ~278)
//	overall 313-417      → PROFICIENT  (Level 4 init produces ~348)
//	overall >= 418       → MASTERED    (Level 5 init produces ~488)
func (m MasteryBreakdown) CalculateMasteryLevel() MasteryLevel {
	return MasteryLevelFromOverall(m.CalculateOverall())
}

// MasteryLevelFromOverall converts an overall score (0-500) to a MasteryLevel.
func MasteryLevelFromOverall(overall int32) MasteryLevel {
	switch {
	case overall == 0:
		return MasteryLevelUnspecified
	case overall < 126:
		return MasteryLevelUnknown
	case overall < 220:
		return MasteryLevelRecognized
	case overall < 313:
		return MasteryLevelUnderstood
	case overall < 418:
		return MasteryLevelProficient
	default:
		return MasteryLevelMastered
	}
}

// Normalize ensures overall is calculated from dimensions.
func (m *MasteryBreakdown) Normalize() {
	m.Overall = m.CalculateOverall()
}

// InitializeFromUserMasteryLevel converts user's mastery level (1-5) into
// four-dimensional breakdown based on typical language learning progression.
// Level 0 means unspecified (user hasn't set a level).
//
// Conversion rationale:
//   - Receptive skills (read/listen) develop before productive skills (spell/speak)
//   - Reading is typically easier than listening (visual vs auditory input)
//   - Speaking is easier than spelling (phonetic vs orthographic accuracy)
//   - Conservative production estimates avoid over-estimating active skills
func (m *MasteryBreakdown) InitializeFromUserMasteryLevel(level int32) {
	switch level {
	case 0:
		// Unspecified - user hasn't set a level
		m.Listen, m.Read, m.Spell, m.Pronounce = 0, 0, 0, 0
	case 1:
		// Unknown - completely unfamiliar (overall ~ 90)
		m.Listen, m.Read, m.Spell, m.Pronounce = 1, 2, 0, 0
	case 2:
		// Recognized - seen before, can identify (overall ~ 162)
		m.Listen, m.Read, m.Spell, m.Pronounce = 2, 3, 1, 0
	case 3:
		// Understood - know the meaning (overall ~ 278)
		m.Listen, m.Read, m.Spell, m.Pronounce = 3, 4, 1, 2
	case 4:
		// Proficient - can use actively (overall ~ 348)
		m.Listen, m.Read, m.Spell, m.Pronounce = 4, 4, 2, 3
	case 5:
		// Mastered - fluent, automatic (overall ~ 488)
		m.Listen, m.Read, m.Spell, m.Pronounce = 5, 5, 4, 5
	default:
		// Invalid level, treat as unspecified
		m.Listen, m.Read, m.Spell, m.Pronounce = 0, 0, 0, 0
	}

	// Calculate overall from the initialized dimensions
	m.Normalize()
}

// ReviewTiming represents spaced repetition metadata for a user lexeme.
type ReviewTiming struct {
	LastReviewAt time.Time
	NextReviewAt time.Time
	IntervalDays int32
	FailCount    int32 // Cumulative failure count (not reset on success) for FSRS
	Reps         int32 // Total number of reviews (repetitions) for FSRS
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
	uw.Normal = strings.ToLower(uw.Term) // Automatically fill normal field
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

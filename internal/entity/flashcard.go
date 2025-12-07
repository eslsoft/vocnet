package entity

import "time"

// CardType represents the type of flashcard.
type CardType string

const (
	CardTypeCHOICE       CardType = "CHOICE"
	CardTypeSPELLING     CardType = "SPELLING"
	CardTypeSELECT_WORDS CardType = "SELECT_WORDS"
)

// FlashCard represents a single flashcard for vocabulary review.
type FlashCard struct {
	ID          string
	Type        CardType
	LWordID     int64
	Prompt      string
	Question    *CardQuestion
	Options     []*CardItem
	Answer      *CardAnswer
	Difficulty  int32
	Annotations map[string]string
}

// CardQuestion represents the question content of a flashcard.
type CardQuestion struct {
	Text      string
	AutoPlay  bool
	Phonetics []Phonetic
	ImageURL  string
}

// CardItem represents an option or interactive item in a flashcard.
type CardItem struct {
	ID    string
	Text  string
	Hint  string
	Group string // For matching questions
}

// CardAnswer represents the correct answer and validation rules.
type CardAnswer struct {
	CorrectValues []string
	Config        *AnswerConfig
}

// AnswerConfig contains validation configuration.
type AnswerConfig struct {
	IgnoreCase bool
}

// FlashCardSet represents a collection of flashcards with statistics.
type FlashCardSet struct {
	Cards []*FlashCard
	Stats *FlashCardStats
}

// FlashCardStats contains statistics about the flashcard set.
type FlashCardStats struct {
	// Today's total tasks (fixed values for progress calculation)
	TodayDueTotal int32 // Total number of words due at start of day
	TodayNewTotal int32 // Daily new words quota

	// Remaining tasks (dynamic values)
	TodayDueRemaining  int32 // Remaining words due for review
	TodayNewRemaining  int32 // Remaining new words quota
	TodayReviewedCount int32 // Number of cards already reviewed today

	// Other
	EstimatedMinutes int32 // Estimated time to complete current batch (minutes)
}

// AnswerResult represents the result of answering a flashcard.
type AnswerResult struct {
	LWordID          int64
	CardType         CardType
	Correct          bool
	Accuracy         float32
	TimeSpentSeconds int32
	AnsweredAt       time.Time
}

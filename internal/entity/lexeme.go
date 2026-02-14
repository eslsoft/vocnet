package entity

import "time"

// LexemeEntryType distinguishes between top-level entry categories.
type LexemeEntryType string

const (
	LexemeEntryTypeUnspecified LexemeEntryType = ""
	LexemeEntryTypeWord        LexemeEntryType = "WORD"
	LexemeEntryTypePhrase      LexemeEntryType = "PHRASE"
	LexemeEntryTypeIdiom       LexemeEntryType = "IDIOM"
)

// Lexeme captures a semantic entry with its forms, senses, and metadata.
type Lexeme struct {
	ID           int64
	LemmaID      int64  // Foreign key to Lemma
	ExternalID   string // Wikidata Lexeme ID (e.g. "L123456")
	Language     Language
	PartOfSpeech PartOfSpeech
	EntryType    LexemeEntryType
	SenseGloss   string
	Senses       []LexemeSense
	Categories   []string
	Completeness int32

	CreatedAt time.Time
	UpdatedAt time.Time
}

// LexemeSense models a language-specific gloss for a particular part of speech.
type LexemeSense struct {
	Language Language       `json:"language"`
	Gloss    string         `json:"gloss"`
	Examples []SenseExample `json:"examples,omitempty"`
	Provider string         `json:"provider,omitempty"`
}

// SenseExample illustrates a particular sense.
type SenseExample struct {
	Text        string `json:"text"`
	Translation string `json:"translation,omitempty"`
}

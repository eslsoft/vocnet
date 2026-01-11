package entity

import (
	"time"
)

// Lemma represents the canonical form of a word, along with its associated lexemes.
type Lemma struct {
	ID         int64
	LexemeID   string
	Surface    string
	Normalized string
	Variant    string
	Syllables  []string
	Forms      []*LemmaForm

	CreatedAt time.Time
	UpdatedAt time.Time
}

// LexemeForm captures a surfaced variant of a lexeme's lemma.
type LemmaForm struct {
	ID          int64
	LemmaID     int64
	Surface     string
	Normalized  string
	FormType    LexemeFormType
	IsIrregular bool
	Phonetics   []Phonetic
	Syllables   []string

	CreatedAt time.Time
	UpdatedAt time.Time
}

// Phonetic stores IPA/dialect pairs for lexemes.
type Phonetic struct {
	IPA     string `json:"ipa"`
	Dialect string `json:"dialect,omitempty"`
}

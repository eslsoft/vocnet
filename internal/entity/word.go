package entity

import "time"

// Word aggregates multiple lexemes under the same lemma/language key.
type Word struct {
	ID         int64
	WID        string // Stable business identifier: {language}:{lemma}
	Lemma      string
	Language   Language
	Phonetics  []Phonetic
	Categories []string
	Lexemes    []*Lexeme

	Completeness int32
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

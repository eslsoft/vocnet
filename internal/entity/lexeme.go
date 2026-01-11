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

// LexemeFormType enumerates normalized surface-form categories.
type LexemeFormType string

const (
	LexemeFormTypeUnspecified         LexemeFormType = ""
	LexemeFormTypeLemma               LexemeFormType = "LEMMA"
	LexemeFormTypePlural              LexemeFormType = "PLURAL"
	LexemeFormTypePast                LexemeFormType = "PAST"
	LexemeFormTypePastParticiple      LexemeFormType = "PAST_PARTICIPLE"
	LexemeFormTypePresentParticiple   LexemeFormType = "PRESENT_PARTICIPLE"
	LexemeFormTypeThirdPersonSingular LexemeFormType = "THIRD_PERSON_SINGULAR"
	LexemeFormTypeComparative         LexemeFormType = "COMPARATIVE"
	LexemeFormTypeSuperlative         LexemeFormType = "SUPERLATIVE"
	LexemeFormTypeImperative          LexemeFormType = "IMPERATIVE"
	LexemeFormTypeSubjunctive         LexemeFormType = "SUBJUNCTIVE"
	LexemeFormTypeGerund              LexemeFormType = "GERUND"
	LexemeFormTypeShortForm           LexemeFormType = "SHORT_FORM"
)

// Lexeme captures a semantic entry with its forms, senses, and metadata.
type Lexeme struct {
	ID           int64
	ExternalID   string // Wikidata Lexeme ID (e.g. "L123456")
	Language     Language
	PartOfSpeech string
	EntryType    LexemeEntryType
	Level        string
	Frequencies  []Frequency
	SenseGloss   string
	Senses       []LexemeSense
	Relations    []LexemeRelation
	Categories   []string
	Completeness int32

	CreatedAt time.Time
	UpdatedAt time.Time
}

type Frequency struct {
	Corpus string `json:"corpus"`
	Count  int64  `json:"count"`
}

// LexemeSense models a language-specific gloss for a particular part of speech.
type LexemeSense struct {
	Language Language       `json:"language"`
	Gloss    string         `json:"gloss"`
	Examples []SenseExample `json:"examples,omitempty"`
}

// SenseExample illustrates a particular sense.
type SenseExample struct {
	Text        string `json:"text"`
	Translation string `json:"translation,omitempty"`
}

// LexemeRelation links two lexemes semantically.
type LexemeRelation struct {
	LexemeID       string `json:"lexeme_id"`
	TargetLexemeID string `json:"target_lexeme_id"`
	RelationType   int32  `json:"relation_type"`
}

package entity

import "time"

// LexemeEntryType distinguishes between top-level entry categories.
type LexemeEntryType string

const (
	LexemeEntryTypeUnspecified LexemeEntryType = ""
	LexemeEntryTypeWord        LexemeEntryType = "WORD"
	LexemeEntryTypePhrase      LexemeEntryType = "PHRASE"
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

// Lexeme captures a normalized lemma plus its forms, senses, and metadata.
type Lexeme struct {
	ID           int64
	ExternalID   string // Wikidata Lexeme ID (e.g. "L123456")
	WordID       int64
	PartOfSpeech string
	Language     Language
	EntryType    LexemeEntryType
	Lemma        string
	Forms        []LexemeForm
	Senses       []LexemeSense
	Relations    []LexemeRelation

	CreatedAt time.Time
	UpdatedAt time.Time
}

// LexemeForm captures a surfaced variant of a lexeme's lemma.
type LexemeForm struct {
	ID          int64
	LexemeID    int64
	Text        string
	FormType    LexemeFormType
	IsIrregular bool

	CreatedAt time.Time
	UpdatedAt time.Time
}

// Phonetic stores IPA/dialect pairs for lexemes.
type Phonetic struct {
	IPA     string `json:"ipa"`
	Dialect string `json:"dialect,omitempty"`
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

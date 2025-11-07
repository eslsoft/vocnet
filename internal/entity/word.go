package entity

import (
	"time"
)

type Word struct {
	ID             int64
	Text           string
	Language       Language
	WordType       string  // lemma, past, pp (past participle), ing (present participle), 3sg (third person singular), plural, comparative, superlative, variant, derived, other
	Lemma          *string // nil if this row itself is the lemma
	Phonetics      []WordPhonetic
	Definitions    []WordDefinition // only populated for lemma rows
	Categories     []string
	Phrases        []Phrase
	Sentences      []Sentence
	Forms          []WordFormRef // if this is lemma: other forms; if not lemma: empty
	Relations      []WordRelation
	Completeness   int32 // 0-100, calculated from core fields
	IsStandardRule bool  // true if inflection follows standard morphological rules
	IsManualEdited bool  // true if manually edited, false if auto-imported

	CreatedAt time.Time
	UpdatedAt time.Time
}

type WordPhonetic struct {
	IPA     string `json:"ipa"`
	Dialect string `json:"dialect,omitempty"`
}

type WordDefinition struct {
	Pos      string   `json:"pos"`
	Text     string   `json:"text"`
	Language Language `json:"language"`
}

// Sentence captures a short contextual example recorded by the user.
type Sentence struct {
	Text      string `json:"text"`
	Source    int32  `json:"source"`
	SourceRef string `json:"source_ref,omitempty"`
}

type WordFormRef struct {
	Text     string `json:"text"`
	WordType string `json:"word_type"`
}

const WordTypeLemma = "lemma"

// WordRelation models a connection to another dictionary entry.
type WordRelation struct {
	Word         string `json:"word"`
	RelationType int32  `json:"relation_type"`
}

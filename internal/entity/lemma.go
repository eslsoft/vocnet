package entity

import (
	"strings"
	"time"
)

// Lemma aggregates multiple lexemes under the same lemma/language key.
type Lemma struct {
	ID         int64
	WID        string // Stable business identifier: {language}:{lemma}
	Text       string
	Language   Language
	Categories []string
	Lexemes    []*Lexeme

	Completeness int32
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// WordEntry carries lookup context for a lemma and the queried surface term.
type WordEntry struct {
	QueriedTerm     string
	Lemma           *Lemma
	QueriedFormType LexemeFormType
	IsIrregular     bool
}

// IsQueriedLemma reports whether the entry represents a lemma lookup.
func (w *WordEntry) IsQueriedLemma() bool {
	if w == nil || w.Lemma == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(w.QueriedTerm), strings.TrimSpace(w.Lemma.Text))
}

// GetAllForms flattens all lexeme forms on the lemma.
func (w *WordEntry) GetAllForms() []LexemeForm {
	if w == nil || w.Lemma == nil {
		return nil
	}
	var forms []LexemeForm
	for _, lex := range w.Lemma.Lexemes {
		forms = append(forms, lex.Forms...)
	}
	return forms
}

// FindQueriedForm locates the lexeme form matching the queried surface term.
func (w *WordEntry) FindQueriedForm() *LexemeForm {
	if w == nil {
		return nil
	}
	for _, lex := range w.Lemma.Lexemes {
		for i := range lex.Forms {
			form := &lex.Forms[i]
			if strings.EqualFold(strings.TrimSpace(form.Text), strings.TrimSpace(w.QueriedTerm)) {
				return form
			}
		}
	}
	return nil
}

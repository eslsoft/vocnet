package mapping

import (
	"testing"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/stretchr/testify/assert"
)

func TestToPbWord_PopulatesRelatedForms_ForForms(t *testing.T) {
	// Setup a word entry for "run" with forms "runs", "running", "ran"
	lemmaID := int64(1)
	lemmaFormID := int64(10)
	runsFormID := int64(11)
	runningFormID := int64(12)
	ranFormID := int64(13)

	forms := []*entity.LemmaForm{
		{
			ID:         lemmaFormID,
			LemmaID:    lemmaID,
			Surface:    "run",
			Normalized: "run",
			FormType:   entity.LexemeFormTypeLemma,
		},
		{
			ID:         runsFormID,
			LemmaID:    lemmaID,
			Surface:    "runs",
			Normalized: "runs",
			FormType:   entity.LexemeFormTypeThirdPersonSingular,
		},
		{
			ID:         runningFormID,
			LemmaID:    lemmaID,
			Surface:    "running",
			Normalized: "running",
			FormType:   entity.LexemeFormTypePresentParticiple,
		},
		{
			ID:         ranFormID,
			LemmaID:    lemmaID,
			Surface:    "ran",
			Normalized: "ran",
			FormType:   entity.LexemeFormTypePast,
		},
	}

	lemma := &entity.Lemma{
		ID:         lemmaID,
		Surface:    "run",
		Normalized: "run",
		Forms:      forms,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	// Test case 1: Query "running" (a form)
	// Expectation: RelatedForms should include "run", "runs", "ran", but NOT "running"
	entry := &entity.WordEntry{
		QueriedTerm: "running",
		Lemma:       lemma,
		Lexemies:    []entity.Lexeme{}, // Simplified
	}

	pbWord := ToPbWord(entry)
	assert.NotNil(t, pbWord)
	assert.Equal(t, "running", pbWord.Term)
	assert.Equal(t, dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, pbWord.TermType)

	// Verify RelatedForms
	assert.NotEmpty(t, pbWord.RelatedForms, "RelatedForms should not be empty for form lookup")

	// Check content of RelatedForms
	var terms []string
	for _, rf := range pbWord.RelatedForms {
		terms = append(terms, rf.Term)
	}

	assert.Contains(t, terms, "run")
	assert.Contains(t, terms, "runs")
	assert.Contains(t, terms, "ran")
	assert.NotContains(t, terms, "running", "Should exclude the queried form itself")
}

func TestToPbWord_PopulatesRelatedForms_ForLemma(t *testing.T) {
	// Setup same data
	lemmaID := int64(1)
	forms := []*entity.LemmaForm{
		{ID: 10, LemmaID: lemmaID, Surface: "run", Normalized: "run", FormType: entity.LexemeFormTypeLemma},
		{ID: 11, LemmaID: lemmaID, Surface: "runs", Normalized: "runs", FormType: entity.LexemeFormTypeThirdPersonSingular},
		{ID: 12, LemmaID: lemmaID, Surface: "running", Normalized: "running", FormType: entity.LexemeFormTypePresentParticiple},
	}
	lemma := &entity.Lemma{ID: lemmaID, Surface: "run", Normalized: "run", Forms: forms}

	// Test case 2: Query "run" (the lemma)
	entry := &entity.WordEntry{
		QueriedTerm: "run",
		Lemma:       lemma,
		Lexemies:    []entity.Lexeme{},
	}

	pbWord := ToPbWord(entry)
	assert.NotNil(t, pbWord)
	assert.Equal(t, "run", pbWord.Term)
	assert.Equal(t, dictv1.FormType_FORM_TYPE_LEMMA, pbWord.TermType)

	assert.NotEmpty(t, pbWord.RelatedForms)
	var terms []string
	for _, rf := range pbWord.RelatedForms {
		terms = append(terms, rf.Term)
	}
	assert.Contains(t, terms, "runs")
	assert.Contains(t, terms, "running")
	assert.NotContains(t, terms, "run", "Should exclude the lemma itself")
}

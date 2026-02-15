package integration

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
)

func TestIntegrationProcessor_PreservesFormType(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	ip := NewIntegrationProcessor(logger)

	// Create existing forms with various FormTypes
	existingForms := []*entity.LemmaForm{
		{Surface: "run", FormType: entity.FormTypeLemma},
		{Surface: "running", FormType: entity.FormTypePresentParticiple},
		{Surface: "ran", FormType: entity.FormTypePast},
		{Surface: "runs", FormType: entity.FormTypeThirdPersonSingular},
	}

	// Create fragments that only update phonetics/syllables (no form.type fragment)
	fragments := map[string][]*scoring.FieldFragment{
		"form:run:phonetics": {
			{
				Type:     "form.phonetics",
				Data:     []entity.Phonetic{{IPA: "/rʌn/", Dialect: "en-US", Provider: "wikidata"}},
				Score:    scoring.FieldScore{Score: 80},
				Provider: "wikidata",
			},
		},
		"form:runs:syllables": {
			{
				Type:     "form.syllables",
				Data:     []string{"runs"},
				Score:    scoring.FieldScore{Score: 70},
				Provider: "moby",
			},
		},
		// Fragment for a form not in existingForms
		"form:runner:phonetics": {
			{
				Type:     "form.phonetics",
				Data:     []entity.Phonetic{{IPA: "/ˈrʌnər/", Dialect: "en-GB", Provider: "ecdict"}},
				Score:    scoring.FieldScore{Score: 75},
				Provider: "ecdict",
			},
		},
	}

	provenance := make(map[string]*DataProvenance)

	// Call integrateForms
	result := ip.integrateForms(fragments, existingForms, provenance)

	// Build lookup map for results
	resultByForm := make(map[string]*entity.LemmaForm)
	for _, f := range result {
		resultByForm[f.Surface] = f
	}

	// Test 1: Forms with fragments should preserve FormType from existingForms
	if form, ok := resultByForm["run"]; !ok {
		t.Error("expected 'run' form in result")
	} else {
		if form.FormType != entity.FormTypeLemma {
			t.Errorf("expected 'run' FormType to be LEMMA, got %q", form.FormType)
		}
		if len(form.Phonetics) == 0 {
			t.Error("expected 'run' to have phonetics from fragment")
		}
	}

	if form, ok := resultByForm["runs"]; !ok {
		t.Error("expected 'runs' form in result")
	} else {
		if form.FormType != entity.FormTypeThirdPersonSingular {
			t.Errorf("expected 'runs' FormType to be THIRD_PERSON_SINGULAR, got %q", form.FormType)
		}
		if len(form.Syllables) == 0 {
			t.Error("expected 'runs' to have syllables from fragment")
		}
	}

	// Test 2: Forms without fragments should still be included (from existingForms)
	if form, ok := resultByForm["running"]; !ok {
		t.Error("expected 'running' form in result (from existingForms)")
	} else if form.FormType != entity.FormTypePresentParticiple {
		t.Errorf("expected 'running' FormType to be PRESENT_PARTICIPLE, got %q", form.FormType)
	}

	if form, ok := resultByForm["ran"]; !ok {
		t.Error("expected 'ran' form in result (from existingForms)")
	} else if form.FormType != entity.FormTypePast {
		t.Errorf("expected 'ran' FormType to be PAST, got %q", form.FormType)
	}

	// Test 3: New forms (not in existingForms) should get default LEMMA FormType
	if form, ok := resultByForm["runner"]; !ok {
		t.Error("expected 'runner' form in result (from fragment)")
	} else {
		if form.FormType != entity.FormTypeLemma {
			t.Errorf("expected 'runner' FormType to default to LEMMA, got %q", form.FormType)
		}
		if len(form.Phonetics) == 0 {
			t.Error("expected 'runner' to have phonetics from fragment")
		}
	}
}

func TestIntegrationProcessor_NoEmptyFormType(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	ip := NewIntegrationProcessor(logger)

	// Create a context with evaluated fragments but no existing forms
	pctx := &pipeline.PipelineContext{
		Term:     "test",
		Language: entity.LanguageEnglish,
		EvaluatedFragments: map[string][]*scoring.FieldFragment{
			"form:test:syllables": {
				{
					Type:     "form.syllables",
					Data:     []string{"test"},
					Score:    scoring.FieldScore{Score: 60},
					Provider: "moby",
				},
			},
		},
		// No existing forms
		Forms: nil,
	}

	result, err := ip.Process(context.Background(), pctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check that all forms have non-empty FormType
	for _, form := range result.Forms {
		if form.FormType == "" {
			t.Errorf("form %q has empty FormType", form.Surface)
		}
	}

	// Check pctx.Forms as well
	for _, form := range pctx.Forms {
		if form.FormType == "" {
			t.Errorf("pctx form %q has empty FormType", form.Surface)
		}
	}
}

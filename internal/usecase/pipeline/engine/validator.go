package engine

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Validator ensures a Lemma row exists for a given term.
// It only does lookup-or-create — no processor execution.
type Validator struct {
	lemmaRepo  repository.LemmaRepository
	lexemeRepo repository.LexemeRepository
	logger     *slog.Logger
}

// NewValidator creates a new Validator.
func NewValidator(
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	logger *slog.Logger,
) *Validator {
	return &Validator{
		lemmaRepo:  lemmaRepo,
		lexemeRepo: lexemeRepo,
		logger:     logger,
	}
}

// EnsureLemma ensures a Lemma exists for the given term.
// If found, loads existing lexemes and forms into context.
// If not found, creates a minimal lemma.
func (v *Validator) EnsureLemma(ctx context.Context, term string, language entity.Language, tier int32) (*PipelineContext, error) {
	pctx := &PipelineContext{
		Term:     term,
		Language: language,
		Tier:     tier,
	}

	// Try to find existing lemma
	existingLemma, err := v.lemmaRepo.LookupByForm(ctx, term, language)
	if err == nil {
		v.logger.Debug("lemma found", "term", term, "lemma_id", existingLemma.ID)
		pctx.Lemma = existingLemma

		// Load existing lexemes
		lexemes, err := v.lexemeRepo.ListByLemmaID(ctx, existingLemma.ID)
		if err == nil {
			pctx.Lexemes = lexemes
		}

		// Forms are loaded as part of lemma
		pctx.Forms = existingLemma.Forms
		return pctx, nil
	}

	// Create minimal lemma
	lemma, err := v.lemmaRepo.CreateMinimal(ctx, term, language)
	if err != nil {
		return nil, fmt.Errorf("create lemma: %w", err)
	}

	v.logger.Debug("created lemma", "term", term, "lemma_id", lemma.ID)
	pctx.Lemma = lemma
	return pctx, nil
}

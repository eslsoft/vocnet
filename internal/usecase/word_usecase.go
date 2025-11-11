package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=word_usecase.go -destination=../mocks/mock_word_usecase.go -package=mocks

// WordUsecase exposes CRUD and query operations for aggregated words.
type WordUsecase interface {
	Create(ctx context.Context, word *entity.Word) (*entity.Word, error)
	Update(ctx context.Context, word *entity.Word) (*entity.Word, error)
	Delete(ctx context.Context, wordID int64) error
	Get(ctx context.Context, wordID int64) (*entity.Word, error)
	List(ctx context.Context, filter *repository.ListWordGroupQuery) ([]*entity.Word, int64, error)
	Lookup(ctx context.Context, surface string, language entity.Language) (*entity.Word, error)
}

type wordUsecase struct {
	groups  repository.WordGroupRepository
	lexemes repository.LexemeRepository
}

func NewWordUsecase(groups repository.WordGroupRepository, lexemes repository.LexemeRepository) WordUsecase {
	return &wordUsecase{
		groups:  groups,
		lexemes: lexemes,
	}
}

func (u *wordUsecase) Create(ctx context.Context, word *entity.Word) (*entity.Word, error) {
	if word == nil {
		return nil, entity.ErrInvalidInput
	}

	// Normalize and generate WID if not set
	word.Lemma = strings.TrimSpace(word.Lemma)
	if word.Lemma == "" {
		return nil, entity.ErrInvalidInput
	}
	if word.WID == "" {
		word.WID = makeWID(word.Language, word.Lemma)
	}

	// 1. Create word in repository
	created, err := u.groups.Create(ctx, word)
	if err != nil {
		return nil, err
	}

	// 2. Create lexemes for this word (from word.Lexemes if provided)
	if len(word.Lexemes) > 0 {
		for _, lex := range word.Lexemes {
			// Set word association
			lex.WordID = created.ID
			lex.Language = created.Language
			lex.Lemma = created.Lemma

			// ExternalID must be provided (from Wikidata)
			if lex.ExternalID == "" {
				return nil, fmt.Errorf("lexeme external_id is required")
			}

			// Create lexeme with forms
			_, err := u.lexemes.Create(ctx, lex)
			if err != nil {
				// Return error instead of continuing silently
				return nil, fmt.Errorf("failed to create lexeme (POS: %s): %w", lex.PartOfSpeech, err)
			}
		}
	}

	// Return word with lexemes populated
	return u.populateLexemes(ctx, created)
}

func (u *wordUsecase) Update(ctx context.Context, word *entity.Word) (*entity.Word, error) {
	if word == nil || word.ID == 0 {
		return nil, entity.ErrInvalidInput
	}

	// Normalize lemma
	word.Lemma = strings.TrimSpace(word.Lemma)
	if word.Lemma == "" {
		return nil, entity.ErrInvalidInput
	}

	// 1. Update word basic info in repository
	updated, err := u.groups.Update(ctx, word)
	if err != nil {
		return nil, err
	}

	// 2. Delete old lexemes (will cascade delete forms)
	oldLexemes, err := u.lexemes.ListByWordID(ctx, word.ID)
	if err == nil {
		for _, lex := range oldLexemes {
			_ = u.lexemes.Delete(ctx, lex.ID) // Best effort
		}
	}

	// 3. Create new lexemes (from word.Lexemes if provided)
	if len(word.Lexemes) > 0 {
		for _, lex := range word.Lexemes {
			// Set word association
			lex.WordID = updated.ID
			lex.Language = updated.Language
			lex.Lemma = updated.Lemma

			// ExternalID must be provided (from Wikidata)
			if lex.ExternalID == "" {
				return nil, fmt.Errorf("lexeme external_id is required")
			}

			// Create lexeme with forms
			_, err := u.lexemes.Create(ctx, lex)
			if err != nil {
				// Log error but continue (partial success)
				continue
			}
		}
	}

	// Return word with lexemes populated
	return u.populateLexemes(ctx, updated)
}

func (u *wordUsecase) Delete(ctx context.Context, wordID int64) error {
	if wordID == 0 {
		return entity.ErrInvalidInput
	}

	// Delete word (associated lexemes will have word_id set to NULL)
	return u.groups.Delete(ctx, wordID)
}

func (u *wordUsecase) Get(ctx context.Context, wordID int64) (*entity.Word, error) {
	word, err := u.groups.GetByID(ctx, wordID)
	if err != nil {
		return nil, err
	}
	return u.populateLexemes(ctx, word)
}

func (u *wordUsecase) List(ctx context.Context, filter *repository.ListWordGroupQuery) ([]*entity.Word, int64, error) {
	if filter == nil {
		filter = &repository.ListWordGroupQuery{
			Pagination: repository.Pagination{PageNo: 1, PageSize: 20},
		}
	}
	words, total, err := u.groups.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	lexemeMap, err := u.fetchLexemeMap(ctx, words)
	if err != nil {
		return nil, 0, err
	}

	all := make([]*entity.Word, 0, len(words))
	for _, item := range words {
		all = append(all, u.buildWordFromCache(item, lexemeMap))
	}
	return all, total, nil
}

func (u *wordUsecase) Lookup(ctx context.Context, surface string, language entity.Language) (*entity.Word, error) {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return nil, entity.ErrInvalidLexemeText
	}
	// Try to match lemma directly via WID
	wid := makeWID(language, surface)
	wordMeta, err := u.groups.GetByWID(ctx, wid)
	if err == nil {
		return u.populateLexemes(ctx, wordMeta)
	}

	// Try lexeme lookup
	lexeme, err := u.lexemes.Lookup(ctx, surface, language)
	if err != nil {
		return nil, err
	}
	if lexeme == nil {
		return nil, nil
	}
	// Get word by WordID
	if lexeme.WordID == 0 {
		return nil, nil
	}
	wordMeta, err = u.groups.GetByID(ctx, lexeme.WordID)
	if err != nil {
		return nil, err
	}
	return u.populateLexemes(ctx, wordMeta)
}

func (u *wordUsecase) populateLexemes(ctx context.Context, word *entity.Word) (*entity.Word, error) {
	// Query lexemes by WordID
	lexemes, err := u.lexemes.ListByWordID(ctx, word.ID)
	if err != nil {
		return nil, err
	}
	result := *word
	result.Lexemes = lexemes
	return &result, nil
}

func (u *wordUsecase) fetchLexemeMap(ctx context.Context, groups []*entity.Word) (map[int64]*entity.Lexeme, error) {
	ids := make([]int64, 0)
	seen := make(map[int64]struct{})
	for _, group := range groups {
		// Get all lexemes for this word
		lexemes, err := u.lexemes.ListByWordID(ctx, group.ID)
		if err != nil {
			return nil, err
		}
		for _, lex := range lexemes {
			if _, ok := seen[lex.ID]; ok {
				continue
			}
			seen[lex.ID] = struct{}{}
			ids = append(ids, lex.ID)
		}
	}
	lexemes, err := u.lexemes.ListByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	result := make(map[int64]*entity.Lexeme, len(lexemes))
	for _, lex := range lexemes {
		result[lex.ID] = lex
	}
	return result, nil
}

func (u *wordUsecase) buildWordFromCache(meta *entity.Word, lexemeMap map[int64]*entity.Lexeme) *entity.Word {
	// Note: Since we don't have LexemeIDs stored anymore, we need to get them from the lexemeMap
	lexemes := make([]*entity.Lexeme, 0)
	for _, lex := range lexemeMap {
		if lex.WordID == meta.ID {
			lexemes = append(lexemes, lex)
		}
	}
	result := *meta
	result.Lexemes = lexemes
	return &result
}

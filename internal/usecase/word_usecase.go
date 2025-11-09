package usecase

import (
	"context"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// WordUsecase exposes read operations for aggregated words.
type WordUsecase interface {
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

package usecase

import (
	"context"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=word_usecase.go -destination=../mocks/mock_word_usecase.go -package=mocks

// WordUsecase exposes read-only word lookup and list queries.
type WordUsecase interface {
	// Query operations (read-only, write operations removed per user request)
	GetLemma(ctx context.Context, lemmaID int64) (*entity.WordEntry, error)
	Lookup(ctx context.Context, surface string, language entity.Language) (*entity.WordEntry, error)
	List(ctx context.Context, filter *repository.ListWordsQuery) ([]*entity.WordEntry, int64, error)
	ListCategories(ctx context.Context, search string) ([]string, error)
	Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error)
}

type wordUsecase struct {
	lemmas  repository.LemmaRepository
	lexemes repository.LexemeRepository
}

// NewWordUsecase wires the lemma and lexeme repositories into a cohesive service.
func NewWordUsecase(lemmas repository.LemmaRepository, lexemes repository.LexemeRepository) WordUsecase {
	return &wordUsecase{
		lemmas:  lemmas,
		lexemes: lexemes,
	}
}

func (u *wordUsecase) GetLemma(ctx context.Context, lemmaID int64) (*entity.WordEntry, error) {
	if lemmaID == 0 {
		return nil, entity.ErrInvalidInput
	}
	lemma, err := u.lemmas.GetByID(ctx, lemmaID)
	if err != nil {
		return nil, err
	}
	return u.buildWordEntry(ctx, lemma, lemma.Surface)
}

func (u *wordUsecase) Lookup(ctx context.Context, surface string, language entity.Language) (*entity.WordEntry, error) {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return nil, entity.ErrInvalidLexemeText
	}

	// Look up the lemma by the surface form (could be lemma itself or an inflected form)
	lemma, err := u.lemmas.LookupByForm(ctx, surface, language)
	if err != nil {
		return nil, err
	}

	return u.buildWordEntry(ctx, lemma, surface)
}

func (u *wordUsecase) List(ctx context.Context, query *repository.ListWordsQuery) ([]*entity.WordEntry, int64, error) {
	if surfaceTerms := query.SurfaceTerms; len(surfaceTerms) > 0 {
		entries := make([]*entity.WordEntry, 0, len(surfaceTerms))
		seen := make(map[int64]struct{})
		for _, term := range surfaceTerms {
			lemmas, err := u.lemmas.ListByFormNormalized(ctx, term, entity.Language(query.Language))
			if err != nil {
				continue
			}
			for _, lemma := range lemmas {
				if lemma == nil {
					continue
				}
				if _, ok := seen[lemma.ID]; ok {
					continue
				}
				entry, err := u.buildWordEntry(ctx, lemma, term)
				if err != nil || entry == nil {
					continue
				}
				entries = append(entries, entry)
				seen[lemma.ID] = struct{}{}
			}
		}
		return entries, int64(len(entries)), nil
	}

	lemmas, total, err := u.lemmas.List(ctx, query)
	if err != nil {
		return nil, 0, err
	}

	entries := make([]*entity.WordEntry, 0, len(lemmas))
	for _, lemma := range lemmas {
		entry, err := u.buildWordEntry(ctx, lemma, lemma.Surface)
		if err != nil {
			return nil, 0, err
		}
		entries = append(entries, entry)
	}
	return entries, total, nil
}

func (u *wordUsecase) ListCategories(ctx context.Context, search string) ([]string, error) {
	return u.lemmas.ListCategories(ctx, search)
}

func (u *wordUsecase) Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error) {
	return u.lemmas.Stats(ctx, filter)
}

func (u *wordUsecase) buildWordEntry(ctx context.Context, lemma *entity.Lemma, queriedTerm string) (*entity.WordEntry, error) {
	lexemes, err := u.fetchLexemesByLemma(ctx, lemma.ID)
	if err != nil {
		return nil, err
	}

	// Merge lexemes from other lemmas that share the same surface form
	// (e.g., adopted as adj vs adopt as verb).
	lexemes = u.mergeRelatedLexemes(ctx, lexemes, lemma)

	entry := &entity.WordEntry{
		QueriedTerm: strings.TrimSpace(queriedTerm),
		Lemma:       lemma,
		Lexemies:    lexemes,
	}

	if entry.QueriedTerm == "" {
		entry.QueriedTerm = lemma.Surface
	}
	return entry, nil
}

func (u *wordUsecase) fetchLexemesByLemma(ctx context.Context, lemmaID int64) ([]entity.Lexeme, error) {
	lexemePtrs, err := u.lexemes.ListByLemmaID(ctx, lemmaID)
	if err != nil {
		return nil, err
	}
	return collectLexemes(lexemePtrs), nil
}

func (u *wordUsecase) mergeRelatedLexemes(ctx context.Context, lexemes []entity.Lexeme, lemma *entity.Lemma) []entity.Lexeme {
	if len(lexemes) == 0 || lemma == nil {
		return lexemes
	}

	lang := lexemes[0].Language
	relatedLemmas, err := u.lemmas.ListByFormNormalized(ctx, lemma.Surface, lang)
	if err != nil {
		return lexemes
	}

	existing := make(map[int64]struct{}, len(lexemes))
	for _, lex := range lexemes {
		existing[lex.ID] = struct{}{}
	}

	for _, related := range relatedLemmas {
		if related == nil || related.ID == lemma.ID {
			continue
		}
		relatedLexemePtrs, err := u.lexemes.ListByLemmaID(ctx, related.ID)
		if err != nil {
			continue
		}
		for _, lex := range collectLexemes(relatedLexemePtrs) {
			if _, ok := existing[lex.ID]; ok {
				continue
			}
			lexemes = append(lexemes, lex)
			existing[lex.ID] = struct{}{}
		}
	}

	return lexemes
}

func collectLexemes(lexemePtrs []*entity.Lexeme) []entity.Lexeme {
	if len(lexemePtrs) == 0 {
		return nil
	}
	lexemes := make([]entity.Lexeme, 0, len(lexemePtrs))
	for _, lex := range lexemePtrs {
		if lex != nil {
			lexemes = append(lexemes, *lex)
		}
	}
	return lexemes
}

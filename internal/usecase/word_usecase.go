package usecase

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=word_usecase.go -destination=../mocks/mock_word_usecase.go -package=mocks

var (
	surfaceFilterPattern  = regexp.MustCompile(`(?i)surface\s+in\s*\[(.*?)\]`)
	languageFilterPattern = regexp.MustCompile(`(?i)language\s*==\s*['"]([a-zA-Z_-]+)['"]`)
)

// WordUsecase exposes lemma management plus lookup/list queries backed by word entries.
type WordUsecase interface {
	CreateLemma(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error)
	UpdateLemma(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error)
	DeleteLemma(ctx context.Context, lemmaID int64) error
	GetLemma(ctx context.Context, lemmaID int64) (*entity.Lemma, error)
	Lookup(ctx context.Context, surface string, language entity.Language) (*entity.WordEntry, error)
	List(ctx context.Context, filter *repository.ListLemmaQuery) ([]*entity.WordEntry, int64, error)
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

func (u *wordUsecase) CreateLemma(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error) {
	payload, err := normalizeLemmaPayload(lemma)
	if err != nil {
		return nil, err
	}

	created, err := u.lemmas.Create(ctx, payload)
	if err != nil {
		return nil, err
	}
	if err := u.replaceLexemes(ctx, created, payload.Lexemes); err != nil {
		return nil, err
	}
	return u.populateLexemes(ctx, created)
}

func (u *wordUsecase) UpdateLemma(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error) {
	if lemma == nil || lemma.ID == 0 {
		return nil, entity.ErrInvalidInput
	}

	payload, err := normalizeLemmaPayload(lemma)
	if err != nil {
		return nil, err
	}
	payload.ID = lemma.ID

	updated, err := u.lemmas.Update(ctx, payload)
	if err != nil {
		return nil, err
	}

	// Replace lexemes by re-importing payload lexemes after clearing old ones.
	oldLexemes, err := u.lexemes.ListByLemmaID(ctx, updated.ID)
	if err == nil {
		for _, lex := range oldLexemes {
			_ = u.lexemes.Delete(ctx, lex.ID)
		}
	}
	if err := u.replaceLexemes(ctx, updated, payload.Lexemes); err != nil {
		return nil, err
	}
	return u.populateLexemes(ctx, updated)
}

func (u *wordUsecase) DeleteLemma(ctx context.Context, lemmaID int64) error {
	if lemmaID == 0 {
		return entity.ErrInvalidInput
	}
	return u.lemmas.Delete(ctx, lemmaID)
}

func (u *wordUsecase) GetLemma(ctx context.Context, lemmaID int64) (*entity.Lemma, error) {
	if lemmaID == 0 {
		return nil, entity.ErrInvalidInput
	}
	lemma, err := u.lemmas.GetByID(ctx, lemmaID)
	if err != nil {
		return nil, err
	}
	return u.populateLexemes(ctx, lemma)
}

func (u *wordUsecase) Lookup(ctx context.Context, surface string, language entity.Language) (*entity.WordEntry, error) {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return nil, entity.ErrInvalidLexemeText
	}

	wid := makeWID(language, surface)
	lemma, err := u.lemmas.GetByWID(ctx, wid)
	if err == nil {
		return u.buildWordEntry(ctx, lemma, surface)
	}
	if err != nil && !errors.Is(err, entity.ErrWordNotFound) {
		return nil, err
	}

	lexeme, err := u.lexemes.Lookup(ctx, surface, language)
	if err != nil || lexeme == nil {
		return nil, err
	}
	if lexeme.LemmaID == 0 {
		return nil, nil
	}

	lemma, err = u.lemmas.GetByID(ctx, lexeme.LemmaID)
	if err != nil {
		return nil, err
	}
	return u.buildWordEntry(ctx, lemma, surface)
}

func (u *wordUsecase) List(ctx context.Context, filter *repository.ListLemmaQuery) ([]*entity.WordEntry, int64, error) {
	if filter == nil {
		filter = &repository.ListLemmaQuery{
			Pagination: repository.Pagination{PageNo: 1, PageSize: 20},
		}
	}

	filterExpr := filter.GetFilter()
	surfaceTerms := extractSurfaceTerms(filterExpr)
	lang := extractLanguageFilter(filterExpr)
	if lang == entity.LanguageUnspecified {
		lang = entity.LanguageEnglish
	}

	if len(surfaceTerms) > 0 {
		entries := make([]*entity.WordEntry, 0, len(surfaceTerms))
		for _, term := range surfaceTerms {
			entry, err := u.Lookup(ctx, term, lang)
			if err != nil {
				continue
			}
			if entry != nil {
				entries = append(entries, entry)
			}
		}
		return entries, int64(len(entries)), nil
	}

	lemmas, total, err := u.lemmas.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}

	entries := make([]*entity.WordEntry, 0, len(lemmas))
	for _, lemma := range lemmas {
		entry, err := u.buildWordEntry(ctx, lemma, lemma.Text)
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

func (u *wordUsecase) replaceLexemes(ctx context.Context, lemma *entity.Lemma, lexemes []*entity.Lexeme) error {
	if lemma == nil || len(lexemes) == 0 {
		return nil
	}
	for _, lex := range lexemes {
		if lex == nil {
			continue
		}
		payload := *lex
		payload.LemmaID = lemma.ID
		payload.Language = lemma.Language
		payload.Lemma = lemma.Text
		if strings.TrimSpace(payload.ExternalID) == "" {
			return fmt.Errorf("lexeme external_id is required")
		}
		if _, err := u.lexemes.Create(ctx, &payload); err != nil {
			return fmt.Errorf("failed to create lexeme (POS: %s): %w", payload.PartOfSpeech, err)
		}
	}
	return nil
}

func (u *wordUsecase) populateLexemes(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error) {
	lexemes, err := u.lexemes.ListByLemmaID(ctx, lemma.ID)
	if err != nil {
		return nil, err
	}
	result := *lemma
	result.Lexemes = lexemes
	return &result, nil
}

func (u *wordUsecase) buildWordEntry(ctx context.Context, lemma *entity.Lemma, queriedTerm string) (*entity.WordEntry, error) {
	lemmaWithLexemes, err := u.populateLexemes(ctx, lemma)
	if err != nil {
		return nil, err
	}
	entry := &entity.WordEntry{
		QueriedTerm: strings.TrimSpace(queriedTerm),
		Lemma:       lemmaWithLexemes,
	}
	if entry.QueriedTerm == "" {
		entry.QueriedTerm = lemmaWithLexemes.Text
	}

	if form := entry.FindQueriedForm(); form != nil {
		entry.QueriedFormType = form.FormType
		entry.IsIrregular = form.IsIrregular
	} else {
		entry.QueriedFormType = entity.LexemeFormTypeLemma
		entry.IsIrregular = false
	}
	return entry, nil
}

func normalizeLemmaPayload(in *entity.Lemma) (*entity.Lemma, error) {
	if in == nil {
		return nil, entity.ErrInvalidInput
	}
	out := *in
	out.Text = strings.TrimSpace(out.Text)
	if out.Text == "" {
		return nil, entity.ErrInvalidInput
	}
	if out.Language == entity.LanguageUnspecified {
		out.Language = entity.LanguageEnglish
	}
	if strings.TrimSpace(out.WID) == "" {
		out.WID = makeWID(out.Language, out.Text)
	}
	if len(in.Lexemes) > 0 {
		out.Lexemes = make([]*entity.Lexeme, 0, len(in.Lexemes))
		for _, lex := range in.Lexemes {
			if lex == nil {
				continue
			}
			copyLex := *lex
			out.Lexemes = append(out.Lexemes, &copyLex)
		}
	}
	return &out, nil
}

func extractSurfaceTerms(filter string) []string {
	matches := surfaceFilterPattern.FindStringSubmatch(filter)
	if len(matches) < 2 {
		return nil
	}
	body := matches[1]
	rawItems := strings.Split(body, ",")
	terms := make([]string, 0, len(rawItems))
	for _, item := range rawItems {
		trimmed := strings.TrimSpace(item)
		trimmed = strings.Trim(trimmed, `"'`)
		if trimmed == "" {
			continue
		}
		terms = append(terms, trimmed)
	}
	return terms
}

func extractLanguageFilter(filter string) entity.Language {
	matches := languageFilterPattern.FindStringSubmatch(filter)
	if len(matches) < 2 {
		return entity.LanguageUnspecified
	}
	code := strings.TrimSpace(matches[1])
	if code == "" {
		return entity.LanguageUnspecified
	}
	return entity.ParseLanguage(code)
}

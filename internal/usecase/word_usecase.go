package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=word_usecase.go -destination=../mocks/mock_word_usecase.go -package=mocks

type ListWordsQuery struct {
	repository.Pagination

	Language     string
	Keyword      string
	Categories   []string
	SurfaceTerms []string

	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

// WordUsecase exposes lemma management plus lookup/list queries backed by word entries.
type WordUsecase interface {
	CreateLemma(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error)
	UpdateLemma(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error)
	DeleteLemma(ctx context.Context, lemmaID int64) error
	GetLemma(ctx context.Context, lemmaID int64) (*entity.Lemma, error)
	Lookup(ctx context.Context, surface string, language entity.Language) (*entity.WordEntry, error)
	List(ctx context.Context, filter *ListWordsQuery) ([]*entity.WordEntry, int64, error)
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

	// CRITICAL: Preserve existing forms when updating with incomplete data
	// This happens when updating from a form view (which doesn't include RelatedForms)
	existingLemma, err := u.GetLemma(ctx, lemma.ID)
	if err == nil && existingLemma != nil {
		lemma = preserveExistingForms(existingLemma, lemma)
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
			if delErr := u.lexemes.Delete(ctx, lex.ID); delErr != nil {
				// Log but don't fail - lexeme might already be deleted or in use
				// The replaceLexemes will handle conflicts appropriately
				continue
			}
		}
	}
	if err := u.replaceLexemes(ctx, updated, payload.Lexemes); err != nil {
		return nil, err
	}
	return u.populateLexemes(ctx, updated)
}

// preserveExistingForms merges forms from existing lemma into incoming update
// to prevent data loss when updating from incomplete data (e.g., form views)
func preserveExistingForms(existing, incoming *entity.Lemma) *entity.Lemma {
	if existing == nil || incoming == nil {
		return incoming
	}

	// Build a map of existing forms by external_id
	existingFormsByLexeme := make(map[string][]entity.LexemeForm)
	for _, lex := range existing.Lexemes {
		if lex.ExternalID != "" {
			existingFormsByLexeme[lex.ExternalID] = lex.Forms
		}
	}

	// Merge forms into incoming lexemes
	result := *incoming
	for i, lex := range result.Lexemes {
		if existingForms, ok := existingFormsByLexeme[lex.ExternalID]; ok {
			// Merge forms: keep all existing forms, add new ones
			mergedForms := mergeFormLists(existingForms, lex.Forms)
			result.Lexemes[i].Forms = mergedForms
		}
	}

	return &result
}

// mergeFormLists merges two form lists, preserving all unique forms
func mergeFormLists(existing, incoming []entity.LexemeForm) []entity.LexemeForm {
	if len(existing) == 0 {
		return append([]entity.LexemeForm(nil), incoming...)
	}
	if len(incoming) == 0 {
		return append([]entity.LexemeForm(nil), existing...)
	}

	result := make([]entity.LexemeForm, 0, len(existing)+len(incoming))
	index := make(map[string]int, len(existing))

	for _, form := range existing {
		key := canonicalFormKey(form)
		index[key] = len(result)
		result = append(result, form)
	}

	for _, form := range incoming {
		key := canonicalFormKey(form)
		if idx, ok := index[key]; ok {
			merged := result[idx]
			merged = mergeLexemeForm(merged, form)
			result[idx] = merged
			continue
		}
		result = append(result, form)
	}

	return result
}

func canonicalFormKey(form entity.LexemeForm) string {
	return strings.ToLower(strings.TrimSpace(form.Text)) + "|" + string(form.FormType)
}

// mergeLexemeForm prefers the incoming data but only overrides fields when values are provided.
func mergeLexemeForm(base entity.LexemeForm, incoming entity.LexemeForm) entity.LexemeForm {
	if trimmed := strings.TrimSpace(incoming.Text); trimmed != "" {
		base.Text = trimmed
	}
	if incoming.FormType != entity.LexemeFormTypeUnspecified {
		base.FormType = incoming.FormType
	}
	base.IsIrregular = incoming.IsIrregular
	if len(incoming.Phonetics) > 0 {
		base.Phonetics = append([]entity.Phonetic{}, incoming.Phonetics...)
	}
	return base
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
	} else if !errors.Is(err, entity.ErrWordNotFound) {
		return nil, err
	}

	lexeme, err := u.lexemes.Lookup(ctx, surface, language)
	if err != nil || lexeme == nil {
		return nil, err
	}

	lemma, err = u.lemmas.GetByID(ctx, lexeme.LemmaID)
	if err != nil {
		return nil, err
	}
	return u.buildWordEntry(ctx, lemma, surface)
}

func (u *wordUsecase) List(ctx context.Context, query *ListWordsQuery) ([]*entity.WordEntry, int64, error) {
	filter := &repository.ListLemmaQuery{
		Pagination:    query.Pagination,
		Language:      entity.ParseLanguage(query.Language),
		Keyword:       query.Keyword,
		SurfaceTerms:  query.SurfaceTerms,
		Categories:    query.Categories,
		PrimaryKey:    query.PrimaryKey,
		PrimaryDesc:   query.PrimaryDesc,
		SecondaryKey:  query.SecondaryKey,
		SecondaryDesc: query.SecondaryDesc,
	}

	if surfaceTerms := query.SurfaceTerms; len(surfaceTerms) > 0 {
		entries := make([]*entity.WordEntry, 0, len(surfaceTerms))
		for _, term := range surfaceTerms {
			entry, err := u.Lookup(ctx, term, filter.Language)
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

		// Try to create the lexeme
		_, err := u.lexemes.Create(ctx, &payload)
		if err != nil {
			// If lexeme already exists, try to find and update it
			if errors.Is(err, entity.ErrDuplicateLexeme) {
				// Query for existing lexeme by external_id
				query := &repository.ListLexemeQuery{
					Pagination: repository.Pagination{
						PageNo:   1,
						PageSize: 1,
					},
					ExternalIDs: []string{payload.ExternalID},
				}
				existing, _, listErr := u.lexemes.List(ctx, query)
				if listErr != nil {
					// Query failed - log and return error
					return fmt.Errorf("failed to query existing lexeme (external_id: %s, POS: %s): %v, original error: %w", payload.ExternalID, payload.PartOfSpeech, listErr, err)
				}
				if len(existing) == 0 {
					// Lexeme not found by query but DB says it exists
					// This might be a race condition or the lexeme belongs to a different lemma
					// Try to skip this lexeme and continue
					return fmt.Errorf("lexeme exists but not found by query (external_id: %s, POS: %s): %w", payload.ExternalID, payload.PartOfSpeech, err)
				}

				// Update the existing lexeme with new data
				payload.ID = existing[0].ID
				if _, updateErr := u.lexemes.Update(ctx, &payload); updateErr != nil {
					return fmt.Errorf("failed to update existing lexeme (external_id: %s, POS: %s): %w", payload.ExternalID, payload.PartOfSpeech, updateErr)
				}
				continue
			}
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

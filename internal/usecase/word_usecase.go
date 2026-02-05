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
	// Look up lexemes by the lemma's ID
	lexemePtrs, err := u.lexemes.ListByLemmaID(ctx, lemma.ID)
	if err != nil {
		return nil, err
	}

	// Convert []*entity.Lexeme to []entity.Lexeme
	lexemes := make([]entity.Lexeme, 0, len(lexemePtrs))
	for _, lex := range lexemePtrs {
		if lex != nil {
			lexemes = append(lexemes, *lex)
		}
	}

	// Merge lexemes from other lemmas that share the same surface form
	// (e.g., adopted as adj vs adopt as verb).
	if len(lexemes) > 0 {
		lang := lexemes[0].Language
		relatedLemmas, err := u.lemmas.ListByFormNormalized(ctx, lemma.Surface, lang)
		if err == nil {
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
				for _, lex := range relatedLexemePtrs {
					if lex == nil {
						continue
					}
					if _, ok := existing[lex.ID]; ok {
						continue
					}
					lexemes = append(lexemes, *lex)
					existing[lex.ID] = struct{}{}
				}
			}
		}
	}

	entry := &entity.WordEntry{
		QueriedTerm: strings.TrimSpace(queriedTerm),
		Lemma:       lemma,
		Lexemies:    lexemes,
	}

	// Resolve relation targets to lemma surfaces so API can return relations without exposing IDs.
	entry.RelationTargetLemmas = resolveRelationTargets(ctx, u.lemmas, lexemes)
	if entry.QueriedTerm == "" {
		entry.QueriedTerm = lemma.Surface
	}
	return entry, nil
}

func resolveRelationTargets(ctx context.Context, lemmas repository.LemmaRepository, lexemes []entity.Lexeme) map[string]string {
	if lemmas == nil || len(lexemes) == 0 {
		return map[string]string{}
	}

	// Collect unique target lexeme external IDs.
	targets := make([]string, 0, 16)
	seen := make(map[string]struct{}, 16)
	for _, lex := range lexemes {
		for _, rel := range lex.Relations {
			if rel.TargetLexemeID == "" {
				continue
			}
			if _, ok := seen[rel.TargetLexemeID]; ok {
				continue
			}
			seen[rel.TargetLexemeID] = struct{}{}
			targets = append(targets, rel.TargetLexemeID)
		}
	}
	if len(targets) == 0 {
		return map[string]string{}
	}

	lang := lexemes[0].Language
	resolved, err := lemmas.ResolveLemmaSurfacesByLexemeExternalIDs(ctx, targets, lang)
	if err != nil {
		// Best-effort: relations are enrichment data, do not fail the main lookup.
		return map[string]string{}
	}
	if resolved == nil {
		return map[string]string{}
	}
	return resolved
}

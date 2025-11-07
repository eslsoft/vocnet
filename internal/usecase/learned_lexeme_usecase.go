package usecase

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// LearnedLexemeUsecase encapsulates business logic for managing user vocabulary entries.
type LearnedLexemeUsecase interface {
	CollectLexeme(ctx context.Context, userID int64, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error)
	UpdateMastery(ctx context.Context, userID, id int64, mastery entity.MasteryBreakdown, review entity.ReviewTiming, notes string) (*entity.LearnedLexeme, error)
	ListLearnedLexemes(ctx context.Context, filter *repository.ListLearnedLexemeQuery) ([]entity.LearnedLexeme, int64, error)
	DeleteLearnedLexeme(ctx context.Context, userID, id int64) error
}

// NewLearnedLexemeUsecase wires the repository with default behaviour.
func NewLearnedLexemeUsecase(repo repository.LearnedLexemeRepository, wordRepo repository.WordRepository) LearnedLexemeUsecase {
	return &learnedLexemeUsecase{
		repo:     repo,
		wordRepo: wordRepo,
		clock:    time.Now,
	}
}

type learnedLexemeUsecase struct {
	repo     repository.LearnedLexemeRepository
	wordRepo repository.WordRepository
	clock    func() time.Time
}

func (u *learnedLexemeUsecase) CollectLexeme(ctx context.Context, userID int64, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
	if lexeme == nil {
		return nil, entity.ErrInvalidLearnedLexemeText
	}
	text := strings.TrimSpace(lexeme.Term)
	if text == "" {
		return nil, entity.ErrInvalidLearnedLexemeText
	}

	existing, err := u.repo.FindByTerm(ctx, userID, text)
	if err != nil {
		return nil, err
	}

	now := u.clock()
	if existing != nil {
		// Update lightweight fields on duplicate collects.
		existing.QueryCount++
		if lexeme.Language.Code() != "" {
			existing.Language = entity.NormalizeLanguage(lexeme.Language)
		}
		if lexeme.Notes != "" {
			existing.Notes = lexeme.Notes
		}
		existing.Mastery = lexeme.Mastery
		existing.Review = lexeme.Review
		existing.Normalize(now)
		updated, err := u.repo.Update(ctx, existing)
		if err != nil {
			return nil, err
		}
		if err := u.autoCollectStandardForms(ctx, userID, updated); err != nil {
			return nil, err
		}
		return updated, nil
	}

	copy := *lexeme
	copy.Term = text
	copy.UserID = userID
	if copy.QueryCount == 0 {
		copy.QueryCount = 1
	}
	if copy.CreatedBy == "" {
		copy.CreatedBy = "user"
	}
	copy.Normalize(now)

	created, err := u.repo.Create(ctx, &copy)
	if err != nil {
		return nil, err
	}
	if err := u.autoCollectStandardForms(ctx, userID, created); err != nil {
		return nil, err
	}
	return created, nil
}

func (u *learnedLexemeUsecase) UpdateMastery(ctx context.Context, userID, id int64, mastery entity.MasteryBreakdown, review entity.ReviewTiming, notes string) (*entity.LearnedLexeme, error) {
	if id <= 0 {
		return nil, entity.ErrLearnedLexemeNotFound
	}

	existing, err := u.repo.GetByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}

	existing.Mastery = mastery
	existing.Review = review
	if notes != "" {
		existing.Notes = notes
	}
	existing.Normalize(u.clock())

	return u.repo.Update(ctx, existing)
}

func (u *learnedLexemeUsecase) ListLearnedLexemes(ctx context.Context, query *repository.ListLearnedLexemeQuery) ([]entity.LearnedLexeme, int64, error) {
	return u.repo.List(ctx, query)
}

func (u *learnedLexemeUsecase) DeleteLearnedLexeme(ctx context.Context, userID, id int64) error {
	if id <= 0 {
		return entity.ErrLearnedLexemeNotFound
	}
	return u.repo.Delete(ctx, userID, id)
}

func (u *learnedLexemeUsecase) autoCollectStandardForms(ctx context.Context, userID int64, base *entity.LearnedLexeme) error {
	if u.wordRepo == nil || base == nil {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	lang := entity.NormalizeLanguage(base.Language)
	dictEntry, err := u.wordRepo.Lookup(ctx, base.Term, lang)
	if err != nil || dictEntry == nil {
		return err
	}

	lemma := dictEntry.Text
	if dictEntry.WordType != entity.WordTypeLemma && dictEntry.Lemma != nil {
		lemma = *dictEntry.Lemma
	}
	lemma = strings.TrimSpace(lemma)
	if lemma == "" {
		return nil
	}

	forms, err := u.wordRepo.ListFormsByLemma(ctx, lemma, lang)
	if err != nil {
		return err
	}

	seen := map[string]struct{}{strings.ToLower(base.Term): {}}
	now := u.clock()
	for _, form := range forms {
		if err := ctx.Err(); err != nil {
			return err
		}
		term := strings.TrimSpace(form.Text)
		if term == "" {
			continue
		}
		norm := strings.ToLower(term)
		if _, ok := seen[norm]; ok {
			continue
		}
		seen[norm] = struct{}{}

		formWord, err := u.wordRepo.Lookup(ctx, term, lang)
		if err != nil {
			return err
		}
		if formWord == nil || !formWord.IsStandardRule {
			continue
		}

		existing, err := u.repo.FindByTerm(ctx, userID, formWord.Text)
		if err != nil {
			return err
		}
		if existing != nil {
			continue
		}

		autoLexeme := &entity.LearnedLexeme{
			Term:       formWord.Text,
			UserID:     userID,
			Language:   base.Language,
			CreatedBy:  base.CreatedBy,
			QueryCount: 1,
			Mastery:    base.Mastery,
			Review:     base.Review,
		}
		autoLexeme.Normalize(now)

		if _, err := u.repo.Create(ctx, autoLexeme); err != nil {
			if errors.Is(err, entity.ErrDuplicateLearnedLexeme) {
				continue
			}
			return err
		}
	}
	return nil
}

package usecase

import (
	"context"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// LearnedLexemeUsecase encapsulates business logic for managing user vocabulary entries.
type LearnedLexemeUsecase interface {
	CollectLexeme(ctx context.Context, userID int64, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error)
	UpdateMastery(ctx context.Context, userID int64, lexemeID int64, mastery entity.MasteryBreakdown, review entity.ReviewTiming, formStatus map[string]entity.FormMastery, note string) (*entity.LearnedLexeme, error)
	ListLearnedLexemes(ctx context.Context, filter *repository.ListLearnedLexemeQuery) ([]entity.LearnedLexeme, int64, error)
	DeleteLearnedLexeme(ctx context.Context, userID int64, lexemeID int64) error
}

// NewLearnedLexemeUsecase wires the repository with default behaviour.
func NewLearnedLexemeUsecase(repo repository.LearnedLexemeRepository, lexemeRepo repository.LexemeRepository) LearnedLexemeUsecase {
	return &learnedLexemeUsecase{
		repo:       repo,
		lexemeRepo: lexemeRepo,
		clock:      time.Now,
	}
}

type learnedLexemeUsecase struct {
	repo       repository.LearnedLexemeRepository
	lexemeRepo repository.LexemeRepository
	clock      func() time.Time
}

func (u *learnedLexemeUsecase) CollectLexeme(ctx context.Context, userID int64, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
	if lexeme == nil {
		return nil, entity.ErrInvalidLearnedLexemeText
	}
	lexemeID := lexeme.LexemeID
	if lexemeID == 0 {
		return nil, entity.ErrInvalidLearnedLexemeText
	}

	// Check if already collected
	existing, err := u.repo.FindByLexemeID(ctx, userID, lexemeID)
	if err != nil {
		return nil, err
	}

	now := u.clock()
	if existing != nil {
		// Update existing record
		existing.QueryCount++
		if lexeme.DisplayTerm != "" {
			existing.DisplayTerm = lexeme.DisplayTerm
		}
		if lexeme.Language != entity.LanguageUnspecified {
			existing.Language = entity.NormalizeLanguage(lexeme.Language)
		}
		if len(lexeme.Tags) > 0 {
			existing.Tags = append([]string{}, lexeme.Tags...)
		}
		if lexeme.Note != "" {
			existing.Note = lexeme.Note
		}
		if len(lexeme.Relations) > 0 {
			existing.Relations = append([]entity.LearnedLexemeRelation{}, lexeme.Relations...)
		}
		if len(lexeme.FormStatus) > 0 {
			existing.FormStatus = lexeme.FormStatus
		}
		existing.Mastery = lexeme.Mastery
		existing.Review = lexeme.Review
		existing.Normalize(now)
		return u.repo.Update(ctx, existing)
	}

	// Fetch lexeme to get LID
	lex, err := u.lexemeRepo.GetByID(ctx, lexemeID)
	if err != nil {
		return nil, err
	}

	// Create new learned lexeme
	copy := *lexeme
	copy.LexemeID = lexemeID
	copy.LexemeLID = lex.LID  // Copy LID from lexeme for migration safety
	copy.UserID = userID
	if copy.QueryCount == 0 {
		copy.QueryCount = 1
	}
	if copy.CreatedBy == "" {
		copy.CreatedBy = "user"
	}
	copy.Normalize(now)

	return u.repo.Create(ctx, &copy)
}

func (u *learnedLexemeUsecase) UpdateMastery(ctx context.Context, userID int64, lexemeID int64, mastery entity.MasteryBreakdown, review entity.ReviewTiming, formStatus map[string]entity.FormMastery, note string) (*entity.LearnedLexeme, error) {
	if lexemeID == 0 {
		return nil, entity.ErrLearnedLexemeNotFound
	}

	existing, err := u.repo.GetByLexemeID(ctx, userID, lexemeID)
	if err != nil {
		return nil, err
	}

	existing.Mastery = mastery
	existing.Review = review
	if formStatus != nil {
		existing.FormStatus = formStatus
	}
	if note != "" {
		existing.Note = note
	}
	existing.Normalize(u.clock())

	return u.repo.Update(ctx, existing)
}

func (u *learnedLexemeUsecase) ListLearnedLexemes(ctx context.Context, query *repository.ListLearnedLexemeQuery) ([]entity.LearnedLexeme, int64, error) {
	return u.repo.List(ctx, query)
}

func (u *learnedLexemeUsecase) DeleteLearnedLexeme(ctx context.Context, userID int64, lexemeID int64) error {
	if lexemeID == 0 {
		return entity.ErrLearnedLexemeNotFound
	}
	return u.repo.DeleteByLexemeID(ctx, userID, lexemeID)
}

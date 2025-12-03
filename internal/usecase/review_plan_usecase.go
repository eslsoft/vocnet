package usecase

import (
	"context"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/auth"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/google/uuid"
)

//go:generate mockgen -source=review_plan_usecase.go -destination=../mocks/mock_review_plan_usecase.go -package=mocks

// ReviewPlanUsecase orchestrates review plan workflows.
type ReviewPlanUsecase interface {
	List(ctx context.Context, query *repository.ListReviewPlanQuery) ([]*entity.ReviewPlan, int64, error)
	Get(ctx context.Context, id int64) (*entity.ReviewPlan, error)
	Create(ctx context.Context, plan *entity.ReviewPlan) (*entity.ReviewPlan, error)
	Update(ctx context.Context, plan *entity.ReviewPlan) (*entity.ReviewPlan, error)
	Delete(ctx context.Context, id int64) error
}

type reviewPlanUsecase struct {
	repo         repository.ReviewPlanRepository
	wordbookRepo repository.WordbookRepository
}

func NewReviewPlanUsecase(repo repository.ReviewPlanRepository, wordbookRepo repository.WordbookRepository) ReviewPlanUsecase {
	return &reviewPlanUsecase{
		repo:         repo,
		wordbookRepo: wordbookRepo,
	}
}

func (u *reviewPlanUsecase) List(ctx context.Context, query *repository.ListReviewPlanQuery) ([]*entity.ReviewPlan, int64, error) {
	userID := auth.GetUserIDOrZero(ctx)

	if query == nil {
		query = &repository.ListReviewPlanQuery{}
	}
	query.UserID = userID

	return u.repo.List(ctx, query)
}

func (u *reviewPlanUsecase) Get(ctx context.Context, id int64) (*entity.ReviewPlan, error) {
	userID := auth.GetUserIDOrZero(ctx)

	if id <= 0 {
		return nil, entity.ErrInvalidReviewPlanID
	}
	return u.repo.GetByID(ctx, id, userID)
}

func (u *reviewPlanUsecase) Create(ctx context.Context, plan *entity.ReviewPlan) (*entity.ReviewPlan, error) {
	userID := auth.MustGetUserID(ctx)

	plan.UserID = userID
	now := time.Now()
	plan.CreatedAt = now
	plan.UpdatedAt = now
	normalized, err := entity.NormalizeReviewPlan(plan)
	if err != nil {
		return nil, err
	}

	// Validate all wordbook IDs exist and belong to the user
	if len(normalized.WordbookIDs) > 0 {
		if err := u.validateWordbookIDs(ctx, userID, normalized.WordbookIDs); err != nil {
			return nil, err
		}
	}

	return u.repo.Create(ctx, normalized)
}

func (u *reviewPlanUsecase) Update(ctx context.Context, plan *entity.ReviewPlan) (*entity.ReviewPlan, error) {
	if plan == nil || plan.ID <= 0 {
		return nil, entity.ErrInvalidReviewPlanID
	}

	current, err := u.repo.GetByID(ctx, plan.ID, plan.UserID)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(plan.Name) == "" {
		plan.Name = current.Name
	}
	if plan.Description == "" {
		plan.Description = current.Description
	}
	plan.CreatedAt = current.CreatedAt
	plan.UpdatedAt = time.Now()
	normalized, err := entity.NormalizeReviewPlan(plan)
	if err != nil {
		return nil, err
	}

	// Validate all wordbook IDs exist and belong to the user
	if len(normalized.WordbookIDs) > 0 {
		if err := u.validateWordbookIDs(ctx, plan.UserID, normalized.WordbookIDs); err != nil {
			return nil, err
		}
	}

	return u.repo.Update(ctx, normalized)
}

func (u *reviewPlanUsecase) Delete(ctx context.Context, id int64) error {
	userID := auth.MustGetUserID(ctx)

	if id <= 0 {
		return entity.ErrInvalidReviewPlanID
	}

	// Verify the plan exists and belongs to the user
	_, err := u.repo.GetByID(ctx, id, userID)
	if err != nil {
		return err
	}

	return u.repo.Delete(ctx, id, userID)
}

// validateWordbookIDs checks that all wordbook IDs exist and belong to the user
func (u *reviewPlanUsecase) validateWordbookIDs(ctx context.Context, userID uuid.UUID, wordbookIDs []int64) error {
	if u.wordbookRepo == nil {
		return nil // skip validation if wordbook repo not available
	}

	for _, wbID := range wordbookIDs {
		if wbID <= 0 {
			return entity.ErrInvalidWordbookID
		}
		_, err := u.wordbookRepo.GetByID(ctx, wbID, userID)
		if err != nil {
			if err == entity.ErrWordbookNotFound {
				return entity.ErrInvalidWordbookID
			}
			return err
		}
	}
	return nil
}

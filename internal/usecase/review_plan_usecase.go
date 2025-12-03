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
	learnedRepo  repository.LearnedWordRepository
}

func NewReviewPlanUsecase(
	repo repository.ReviewPlanRepository,
	wordbookRepo repository.WordbookRepository,
	learnedRepo repository.LearnedWordRepository,
) ReviewPlanUsecase {
	return &reviewPlanUsecase{
		repo:         repo,
		wordbookRepo: wordbookRepo,
		learnedRepo:  learnedRepo,
	}
}

func (u *reviewPlanUsecase) List(ctx context.Context, query *repository.ListReviewPlanQuery) ([]*entity.ReviewPlan, int64, error) {
	userID := auth.GetUserIDOrZero(ctx)

	if query == nil {
		query = &repository.ListReviewPlanQuery{}
	}
	query.UserID = userID

	plans, total, err := u.repo.List(ctx, query)
	if err != nil {
		return nil, 0, err
	}

	// Batch attach status to all plans (optimized for N+1 problem)
	u.attachStatusBatch(ctx, plans)

	return plans, total, nil
}

func (u *reviewPlanUsecase) Get(ctx context.Context, id int64) (*entity.ReviewPlan, error) {
	userID := auth.GetUserIDOrZero(ctx)

	if id <= 0 {
		return nil, entity.ErrInvalidReviewPlanID
	}

	plan, err := u.repo.GetByID(ctx, id, userID)
	if err != nil {
		return nil, err
	}

	// Attach status (best-effort)
	u.attachStatus(ctx, plan)

	return plan, nil
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

// attachStatus computes and attaches status to a single review plan
func (u *reviewPlanUsecase) attachStatus(ctx context.Context, plan *entity.ReviewPlan) {
	if plan == nil || u.wordbookRepo == nil || u.learnedRepo == nil {
		return
	}

	// If no wordbooks, return early with empty status
	if len(plan.WordbookIDs) == 0 {
		plan.Status = entity.ReviewPlanStatus{
			Wordbooks: []*entity.Wordbook{},
		}
		return
	}

	// Fetch wordbooks (best-effort, skips missing ones)
	wordbooks, err := u.wordbookRepo.GetByIDs(ctx, plan.WordbookIDs, plan.UserID)
	if err != nil {
		return // best-effort: if fetch fails, leave status empty
	}

	// Extract and deduplicate all terms
	termsMap := make(map[string]struct{})
	for _, wb := range wordbooks {
		for _, term := range wb.Terms {
			termsMap[term] = struct{}{}
		}
	}

	// Convert to slice
	uniqueTerms := make([]string, 0, len(termsMap))
	for term := range termsMap {
		uniqueTerms = append(uniqueTerms, term)
	}

	// Get mastery stats
	var stats entity.WordbookStats
	if len(uniqueTerms) > 0 {
		stats, err = u.learnedRepo.StatsByTerms(ctx, plan.UserID, uniqueTerms)
		if err != nil {
			return // best-effort
		}
	}

	plan.Status = entity.ReviewPlanStatus{
		MasteredWords: stats.MasteredWords,
		LearningWords: stats.LearningWords,
		UnknownWords:  stats.UnknownWords,
		Wordbooks:     wordbooks,
	}
}

// attachStatusBatch efficiently computes status for multiple review plans
// This minimizes database queries by batching wordbook and learned word fetches
func (u *reviewPlanUsecase) attachStatusBatch(ctx context.Context, plans []*entity.ReviewPlan) {
	if len(plans) == 0 || u.wordbookRepo == nil || u.learnedRepo == nil {
		return
	}

	// Step 1: Collect all unique wordbook IDs across all plans
	allWordbookIDs := make(map[int64]bool)
	for _, plan := range plans {
		for _, wbID := range plan.WordbookIDs {
			allWordbookIDs[wbID] = true
		}
	}

	if len(allWordbookIDs) == 0 {
		// Initialize empty status for all plans
		for _, plan := range plans {
			plan.Status = entity.ReviewPlanStatus{
				Wordbooks: []*entity.Wordbook{},
			}
		}
		return
	}

	// Convert to slice for batch fetch
	wordbookIDSlice := make([]int64, 0, len(allWordbookIDs))
	for id := range allWordbookIDs {
		wordbookIDSlice = append(wordbookIDSlice, id)
	}

	// Step 2: Single batch query for all wordbooks
	// All plans should have the same UserID (enforced by List query)
	userID := plans[0].UserID
	wordbooks, err := u.wordbookRepo.GetByIDs(ctx, wordbookIDSlice, userID)
	if err != nil {
		return // best-effort
	}

	// Step 3: Build wordbook lookup map
	wordbookMap := make(map[int64]*entity.Wordbook, len(wordbooks))
	for _, wb := range wordbooks {
		wordbookMap[wb.ID] = wb
	}

	// Step 4: For each plan, compute its specific status
	for _, plan := range plans {
		// Get wordbooks for this plan
		planWordbooks := make([]*entity.Wordbook, 0, len(plan.WordbookIDs))
		for _, wbID := range plan.WordbookIDs {
			if wb, exists := wordbookMap[wbID]; exists {
				planWordbooks = append(planWordbooks, wb)
			}
		}

		// Extract unique terms for this plan
		planTermsMap := make(map[string]struct{})
		for _, wb := range planWordbooks {
			for _, term := range wb.Terms {
				planTermsMap[term] = struct{}{}
			}
		}

		// Convert to slice
		planTerms := make([]string, 0, len(planTermsMap))
		for term := range planTermsMap {
			planTerms = append(planTerms, term)
		}

		// Compute stats for this plan's terms
		var planStats entity.WordbookStats
		if len(planTerms) > 0 {
			planStats, err = u.learnedRepo.StatsByTerms(ctx, plan.UserID, planTerms)
			if err != nil {
				continue // skip this plan if error
			}
		}

		plan.Status = entity.ReviewPlanStatus{
			MasteredWords: planStats.MasteredWords,
			LearningWords: planStats.LearningWords,
			UnknownWords:  planStats.UnknownWords,
			Wordbooks:     planWordbooks,
		}
	}
}

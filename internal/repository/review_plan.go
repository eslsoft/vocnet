package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/google/uuid"
)

// ListReviewPlanQuery holds parameters for paginated review plan queries.
type ListReviewPlanQuery struct {
	Pagination

	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool

	UserID    uuid.UUID
	NameQuery string
}

// ReviewPlanRepository defines data access for review plans.
type ReviewPlanRepository interface {
	Create(ctx context.Context, plan *entity.ReviewPlan) (*entity.ReviewPlan, error)
	Update(ctx context.Context, plan *entity.ReviewPlan) (*entity.ReviewPlan, error)
	Delete(ctx context.Context, id int64, userID uuid.UUID) error
	GetByID(ctx context.Context, id int64, userID uuid.UUID) (*entity.ReviewPlan, error)
	List(ctx context.Context, query *ListReviewPlanQuery) ([]*entity.ReviewPlan, int64, error)
}

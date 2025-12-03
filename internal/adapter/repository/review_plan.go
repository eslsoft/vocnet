package repository

import (
	"context"
	"fmt"
	"strings"

	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entreviewplan "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/reviewplan"
	"github.com/google/uuid"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

type reviewPlanRepository struct {
	client *entdb.Client
}

// NewReviewPlanRepository constructs an ent-backed review plan repository.
func NewReviewPlanRepository(client *entdb.Client) repository.ReviewPlanRepository {
	return &reviewPlanRepository{client: client}
}

func (r *reviewPlanRepository) Create(ctx context.Context, plan *entity.ReviewPlan) (*entity.ReviewPlan, error) {
	builder := r.client.ReviewPlan.Create().
		SetUserID(plan.UserID).
		SetName(strings.TrimSpace(plan.Name)).
		SetDescription(plan.Description).
		SetWordbookIds(append([]int64{}, plan.WordbookIDs...))

	if plan.ID > 0 {
		builder.SetID(plan.ID)
	}
	if !plan.CreatedAt.IsZero() {
		builder.SetCreatedAt(plan.CreatedAt)
	}
	if !plan.UpdatedAt.IsZero() {
		builder.SetUpdatedAt(plan.UpdatedAt)
	}

	rec, err := builder.Save(ctx)
	if err != nil {
		return nil, translateReviewPlanError(err)
	}
	return mapEntReviewPlan(rec), nil
}

func (r *reviewPlanRepository) Update(ctx context.Context, plan *entity.ReviewPlan) (*entity.ReviewPlan, error) {
	builder := r.client.ReviewPlan.UpdateOneID(plan.ID).
		Where(entreviewplan.UserIDEQ(plan.UserID)).
		SetName(strings.TrimSpace(plan.Name)).
		SetDescription(plan.Description).
		SetWordbookIds(append([]int64{}, plan.WordbookIDs...)).
		SetUpdatedAt(plan.UpdatedAt)

	rec, err := builder.Save(ctx)
	if err != nil {
		return nil, translateReviewPlanError(err)
	}
	return mapEntReviewPlan(rec), nil
}

func (r *reviewPlanRepository) Delete(ctx context.Context, id int64, userID uuid.UUID) error {
	err := r.client.ReviewPlan.DeleteOneID(id).
		Where(entreviewplan.UserIDEQ(userID)).
		Exec(ctx)
	if err != nil {
		return translateReviewPlanError(err)
	}
	return nil
}

func (r *reviewPlanRepository) GetByID(ctx context.Context, id int64, userID uuid.UUID) (*entity.ReviewPlan, error) {
	rec, err := r.client.ReviewPlan.Query().
		Where(
			entreviewplan.IDEQ(id),
			entreviewplan.UserIDEQ(userID),
		).
		First(ctx)
	if err != nil {
		return nil, translateReviewPlanError(err)
	}
	return mapEntReviewPlan(rec), nil
}

func (r *reviewPlanRepository) List(ctx context.Context, query *repository.ListReviewPlanQuery) ([]*entity.ReviewPlan, int64, error) {
	q := r.client.ReviewPlan.Query()

	q.Where(entreviewplan.UserIDEQ(query.UserID))

	if query.NameQuery != "" {
		q.Where(entreviewplan.NameContainsFold(query.NameQuery))
	}

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count review plans: %w", err)
	}

	applyReviewPlanOrdering(q, query)

	offset := query.Offset()
	if offset > 0 {
		q.Offset(int(offset))
	}
	if query.PageSize > 0 {
		q.Limit(int(query.PageSize))
	}

	rows, err := q.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list review plans: %w", err)
	}

	result := make([]*entity.ReviewPlan, 0, len(rows))
	for _, rec := range rows {
		result = append(result, mapEntReviewPlan(rec))
	}

	return result, int64(total), nil
}

func applyReviewPlanOrdering(q *entdb.ReviewPlanQuery, params *repository.ListReviewPlanQuery) {
	if params == nil {
		return
	}

	applyKey := func(key string, desc bool) {
		switch key {
		case "name":
			q.Order(entreviewplan.ByName(orderTerm(desc)))
		case "created_at":
			q.Order(entreviewplan.ByCreatedAt(orderTerm(desc)))
		case "updated_at":
			q.Order(entreviewplan.ByUpdatedAt(orderTerm(desc)))
		case "id":
			q.Order(entreviewplan.ByID(orderTerm(desc)))
		default:
			q.Order(entreviewplan.ByID())
		}
	}

	applyKey(params.PrimaryKey, params.PrimaryDesc)
	if params.SecondaryKey != "" {
		applyKey(params.SecondaryKey, params.SecondaryDesc)
	}
	// ensure deterministic order
	q.Order(entreviewplan.ByID())
}

func mapEntReviewPlan(rec *entdb.ReviewPlan) *entity.ReviewPlan {
	if rec == nil {
		return nil
	}
	return &entity.ReviewPlan{
		ID:          rec.ID,
		UserID:      rec.UserID,
		Name:        rec.Name,
		Description: rec.Description,
		WordbookIDs: rec.WordbookIds,
		CreatedAt:   rec.CreatedAt,
		UpdatedAt:   rec.UpdatedAt,
	}
}

func translateReviewPlanError(err error) error {
	switch {
	case entdb.IsNotFound(err):
		return entity.ErrReviewPlanNotFound
	case entdb.IsConstraintError(err):
		// unique constraint on (user_id, name)
		return entity.ErrDuplicateReviewPlan
	default:
		return err
	}
}

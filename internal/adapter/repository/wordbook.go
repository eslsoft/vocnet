package repository

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entwordbook "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/wordbook"
	"github.com/google/uuid"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

type wordbookRepository struct {
	client *entdb.Client
}

// NewWordbookRepository constructs an ent-backed wordbook repository.
func NewWordbookRepository(client *entdb.Client) repository.WordbookRepository {
	return &wordbookRepository{client: client}
}

func (r *wordbookRepository) Create(ctx context.Context, book *entity.Wordbook) (*entity.Wordbook, error) {
	builder := r.client.Wordbook.Create().
		SetUserID(book.UserID).
		SetSource(string(book.Source)).
		SetSortOrder(book.SortOrder).
		SetLanguage(book.Language.CodeOrDefault()).
		SetVisibility(string(book.Visibility)).
		SetName(strings.TrimSpace(book.Name)).
		SetDescription(book.Description).
		SetAnnotations(book.Annotations).
		SetTerms(append([]string{}, book.Terms...))

	if book.ID > 0 {
		builder.SetID(book.ID)
	}
	if !book.CreatedAt.IsZero() {
		builder.SetCreatedAt(book.CreatedAt)
	}
	if !book.UpdatedAt.IsZero() {
		builder.SetUpdatedAt(book.UpdatedAt)
	}

	rec, err := builder.Save(ctx)
	if err != nil {
		return nil, translateWordbookError(err)
	}
	return mapEntWordbook(rec), nil
}

func (r *wordbookRepository) Update(ctx context.Context, book *entity.Wordbook) (*entity.Wordbook, error) {
	builder := r.client.Wordbook.UpdateOneID(book.ID).
		Where(entwordbook.UserIDEQ(book.UserID)).
		SetSource(string(book.Source)).
		SetSortOrder(book.SortOrder).
		SetLanguage(book.Language.CodeOrDefault()).
		SetVisibility(string(book.Visibility)).
		SetName(strings.TrimSpace(book.Name)).
		SetDescription(book.Description).
		SetAnnotations(book.Annotations).
		SetTerms(append([]string{}, book.Terms...)).
		SetUpdatedAt(book.UpdatedAt)

	rec, err := builder.Save(ctx)
	if err != nil {
		return nil, translateWordbookError(err)
	}
	return mapEntWordbook(rec), nil
}

func (r *wordbookRepository) Delete(ctx context.Context, id int64, userID uuid.UUID) error {
	err := r.client.Wordbook.DeleteOneID(id).
		Where(entwordbook.UserIDEQ(userID)).
		Exec(ctx)
	if err != nil {
		return translateWordbookError(err)
	}
	return nil
}

func (r *wordbookRepository) GetByID(ctx context.Context, id int64, userID uuid.UUID) (*entity.Wordbook, error) {
	rec, err := r.client.Wordbook.Query().
		Where(
			entwordbook.IDEQ(id),
			entwordbook.UserIDIn(userID, uuid.Nil),
		).
		First(ctx)
	if err != nil {
		return nil, translateWordbookError(err)
	}
	return mapEntWordbook(rec), nil
}

func (r *wordbookRepository) List(ctx context.Context, query *repository.ListWordbookQuery) ([]*entity.Wordbook, int64, error) {
	q := r.client.Wordbook.Query()

	userIDs := []uuid.UUID{query.UserID}
	if query.IncludeBuiltin && query.UserID != uuid.Nil {
		userIDs = append(userIDs, uuid.Nil)
	}
	q.Where(entwordbook.UserIDIn(userIDs...))

	if query.NameQuery != "" {
		q.Where(entwordbook.NameContainsFold(query.NameQuery))
	}
	if query.Language != "" {
		q.Where(entwordbook.LanguageEQ(query.Language))
	}
	if query.Visibility != "" {
		q.Where(entwordbook.VisibilityEQ(query.Visibility))
	}

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count wordbooks: %w", err)
	}

	applyWordbookOrdering(q, query)

	offset := query.Offset()
	if offset > 0 {
		q.Offset(int(offset))
	}
	if query.PageSize > 0 {
		q.Limit(int(query.PageSize))
	}

	rows, err := q.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list wordbooks: %w", err)
	}

	result := make([]*entity.Wordbook, 0, len(rows))
	for _, rec := range rows {
		result = append(result, mapEntWordbook(rec))
	}

	return result, int64(total), nil
}

func (r *wordbookRepository) SyncBuiltin(ctx context.Context, books []*entity.Wordbook) error {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	ids := make([]int64, 0, len(books))
	for _, book := range books {
		ids = append(ids, book.ID)
		create := tx.Wordbook.Create().
			SetID(book.ID).
			SetUserID(uuid.Nil).
			SetSource(string(entity.WordbookSourceBuiltin)).
			SetSortOrder(book.SortOrder).
			SetLanguage(book.Language.CodeOrDefault()).
			SetVisibility(string(book.Visibility)).
			SetName(strings.TrimSpace(book.Name)).
			SetDescription(book.Description).
			SetAnnotations(book.Annotations).
			SetTerms(append([]string{}, book.Terms...))

		create.OnConflict(
			sql.ConflictColumns(entwordbook.FieldID),
		).
			UpdateNewValues().
			UpdateSortOrder().
			UpdateLanguage().
			UpdateVisibility().
			UpdateName().
			UpdateDescription().
			UpdateAnnotations().
			UpdateTerms().
			UpdateUpdatedAt()

		if _, err := create.Save(ctx); err != nil {
			return fmt.Errorf("upsert builtin wordbook %d: %w", book.ID, err)
		}
	}

	if len(ids) > 0 {
		if _, err := tx.Wordbook.Delete().
			Where(entwordbook.UserIDEQ(uuid.Nil), entwordbook.IDNotIn(ids...)).
			Exec(ctx); err != nil {
			return fmt.Errorf("cleanup stale builtin wordbooks: %w", err)
		}
	}

	return tx.Commit()
}

func applyWordbookOrdering(q *entdb.WordbookQuery, params *repository.ListWordbookQuery) {
	if params == nil {
		return
	}

	applyKey := func(key string, desc bool) {
		switch key {
		case "name":
			q.Order(entwordbook.ByName(orderTerm(desc)))
		case "created_at":
			q.Order(entwordbook.ByCreatedAt(orderTerm(desc)))
		case "updated_at":
			q.Order(entwordbook.ByUpdatedAt(orderTerm(desc)))
		case "id":
			q.Order(entwordbook.ByID(orderTerm(desc)))
		case "sort_order":
			q.Order(entwordbook.BySortOrder(orderTerm(desc)))
		default:
			q.Order(entwordbook.BySortOrder(), entwordbook.ByID())
		}
	}

	applyKey(params.PrimaryKey, params.PrimaryDesc)
	if params.SecondaryKey != "" {
		applyKey(params.SecondaryKey, params.SecondaryDesc)
	}
	// ensure deterministic order
	q.Order(entwordbook.ByID())
}

func mapEntWordbook(rec *entdb.Wordbook) *entity.Wordbook {
	if rec == nil {
		return nil
	}
	return &entity.Wordbook{
		ID:          rec.ID,
		UserID:      rec.UserID,
		Source:      entity.WordbookSource(rec.Source),
		Language:    entity.ParseLanguage(rec.Language),
		Visibility:  entity.WordbookVisibility(rec.Visibility),
		Name:        rec.Name,
		Description: rec.Description,
		Annotations: rec.Annotations,
		Terms:       rec.Terms,
		Stats:       entity.WordbookStats{TotalWords: int32(len(rec.Terms))},
		SortOrder:   rec.SortOrder,
		CreatedAt:   rec.CreatedAt,
		UpdatedAt:   rec.UpdatedAt,
	}
}

func translateWordbookError(err error) error {
	switch {
	case entdb.IsNotFound(err):
		return entity.ErrWordbookNotFound
	case entdb.IsConstraintError(err):
		// unique constraint on (user_id, name)
		return entity.ErrDuplicateWordbook
	default:
		return err
	}
}

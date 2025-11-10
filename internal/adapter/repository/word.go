package repository

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entword "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/word"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/pkg/filterexpr"
)

type wordGroupRepository struct {
	client *entdb.Client
}

// NewWordGroupRepository constructs an ent-backed word group repository.
func NewWordGroupRepository(client *entdb.Client) repository.WordGroupRepository {
	return &wordGroupRepository{client: client}
}

func (r *wordGroupRepository) Upsert(ctx context.Context, group *entity.Word) (*entity.Word, error) {
	if group == nil || strings.TrimSpace(group.WID) == "" {
		return nil, fmt.Errorf("word wid required")
	}

	builder := r.client.Word.Create().
		SetWid(strings.TrimSpace(group.WID)).
		SetLemma(strings.TrimSpace(group.Lemma)).
		SetLanguage(group.Language.CodeOrDefault()).
		SetPhonetics(append([]entity.Phonetic{}, group.Phonetics...)).
		SetCategories(append([]string{}, group.Categories...)).
		SetCompleteness(group.Completeness)

	newID, err := builder.
		OnConflict(
			sql.ConflictColumns(entword.FieldWid),
		).
		UpdateNewValues().
		ID(ctx)
	if err != nil {
		return nil, fmt.Errorf("upsert word: %w", err)
	}
	return r.GetByID(ctx, newID)
}

func (r *wordGroupRepository) GetByID(ctx context.Context, wordID int64) (*entity.Word, error) {
	rec, err := r.client.Word.Get(ctx, wordID)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, err
	}
	return mapEntWord(rec), nil
}

func (r *wordGroupRepository) GetByWID(ctx context.Context, wid string) (*entity.Word, error) {
	rec, err := r.client.Word.Query().
		Where(entword.WidEQ(strings.TrimSpace(wid))).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, err
	}
	return mapEntWord(rec), nil
}

func (r *wordGroupRepository) List(ctx context.Context, query *repository.ListWordGroupQuery) ([]*entity.Word, int64, error) {
	var params listWordGroupParams
	if err := filterexpr.Bind(query, &params, listWordGroupsSchema); err != nil {
		return nil, 0, err
	}

	q := r.client.Word.Query()
	applyWordGroupFilters(q, params)

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count word groups: %w", err)
	}

	applyWordGroupOrdering(q, params)

	if offset := query.Offset(); offset > 0 {
		q.Offset(int(offset))
	}
	if query.PageSize > 0 {
		q.Limit(int(query.PageSize))
	}

	rows, err := q.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list word groups: %w", err)
	}

	out := make([]*entity.Word, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntWord(row))
	}
	return out, int64(total), nil
}

func (r *wordGroupRepository) DeleteByWID(ctx context.Context, wid string) error {
	if strings.TrimSpace(wid) == "" {
		return fmt.Errorf("word wid required")
	}
	_, err := r.client.Word.Delete().
		Where(entword.WidEQ(strings.TrimSpace(wid))).
		Exec(ctx)
	return err
}

type listWordGroupParams struct {
	Language      string
	Keyword       string
	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

func applyWordGroupFilters(q *entdb.WordQuery, params listWordGroupParams) {
	if params.Language != "" {
		q.Where(entword.LanguageEQ(params.Language))
	}
	if params.Keyword != "" {
		q.Where(entword.LemmaContainsFold(params.Keyword))
	}
}

func applyWordGroupOrdering(q *entdb.WordQuery, params listWordGroupParams) {
	// Apply primary ordering
	switch params.PrimaryKey {
	case "lemma":
		if params.PrimaryDesc {
			q.Order(entword.ByLemma(sql.OrderDesc()))
		} else {
			q.Order(entword.ByLemma())
		}
	case "updated_at":
		if params.PrimaryDesc {
			q.Order(entword.ByUpdatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
		} else {
			q.Order(entword.ByUpdatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
		}
	default:
		q.Order(entword.ByUpdatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
	}

	// Apply secondary ordering
	if params.SecondaryKey != "" && params.SecondaryKey != params.PrimaryKey {
		switch params.SecondaryKey {
		case "lemma":
			if params.SecondaryDesc {
				q.Order(entword.ByLemma(sql.OrderDesc()))
			} else {
				q.Order(entword.ByLemma())
			}
		case "updated_at":
			if params.SecondaryDesc {
				q.Order(entword.ByUpdatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entword.ByUpdatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		}
	}
}

func mapEntWord(rec *entdb.Word) *entity.Word {
	if rec == nil {
		return nil
	}
	return &entity.Word{
		ID:           rec.ID,
		WID:          rec.Wid,
		Lemma:        rec.Lemma,
		Language:     entity.ParseLanguage(rec.Language),
		Phonetics:    append([]entity.Phonetic{}, rec.Phonetics...),
		Categories:   append([]string{}, rec.Categories...),
		Completeness: rec.Completeness,
		CreatedAt:    rec.CreatedAt,
		UpdatedAt:    rec.UpdatedAt,
	}
}

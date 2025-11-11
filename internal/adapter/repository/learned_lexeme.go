package repository

import (
	"context"
	"fmt"
	"math"
	"strings"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqljson"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlearnedlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/learnedlexeme"
	entlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	entword "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/word"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/pkg/filterexpr"
)

type LearnedLexemeRepository struct {
	client *entdb.Client
}

func int32ToInt16(value int32, field string) (int16, error) {
	if value > math.MaxInt16 || value < math.MinInt16 {
		return 0, fmt.Errorf("%s out of int16 range: %d", field, value)
	}
	return int16(value), nil
}

// NewLearnedLexemeRepository constructs an ent-backed repository.
func NewLearnedLexemeRepository(client *entdb.Client) repository.LearnedLexemeRepository {
	return &LearnedLexemeRepository{client: client}
}

type listLearnedLexemesParams struct {
	Keyword       string
	LexemeIDs     []int64
	Tags          []string
	Categories    []string
	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

func (r *LearnedLexemeRepository) Create(ctx context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
	listen, err := int32ToInt16(lexeme.Mastery.Listen, "mastery.listen")
	if err != nil {
		return nil, err
	}
	read, err := int32ToInt16(lexeme.Mastery.Read, "mastery.read")
	if err != nil {
		return nil, err
	}
	spell, err := int32ToInt16(lexeme.Mastery.Spell, "mastery.spell")
	if err != nil {
		return nil, err
	}
	pronounce, err := int32ToInt16(lexeme.Mastery.Pronounce, "mastery.pronounce")
	if err != nil {
		return nil, err
	}

	languageCode := entity.NormalizeLanguage(lexeme.Language).Code()

	builder := r.client.LearnedLexeme.Create().
		SetUserID(lexeme.UserID).
		SetLexemeExternalID(strings.TrimSpace(lexeme.LexemeExternalID)).
		SetDisplayTerm(strings.TrimSpace(lexeme.DisplayTerm)).
		SetLanguage(languageCode).
		SetTags(append([]string{}, lexeme.Tags...)).
		SetNote(strings.TrimSpace(lexeme.Note)).
		SetRelations(append([]entity.LearnedLexemeRelation{}, lexeme.Relations...)).
		SetFormStatus(copyFormStatus(lexeme.FormStatus)).
		SetMasteryListen(listen).
		SetMasteryRead(read).
		SetMasterySpell(spell).
		SetMasteryPronounce(pronounce).
		SetMasteryOverall(lexeme.Mastery.Overall).
		SetReviewIntervalDays(lexeme.Review.IntervalDays).
		SetReviewFailCount(lexeme.Review.FailCount).
		SetQueryCount(lexeme.QueryCount).
		SetCreatedBy(lexeme.CreatedBy).
		SetCreatedAt(lexeme.CreatedAt).
		SetUpdatedAt(lexeme.UpdatedAt)

	if lexeme.LexemeID > 0 {
		builder.SetLexemeID(lexeme.LexemeID)
	}

	if !lexeme.Review.LastReviewAt.IsZero() {
		builder.SetReviewLastReviewAt(lexeme.Review.LastReviewAt)
	}
	if !lexeme.Review.NextReviewAt.IsZero() {
		builder.SetReviewNextReviewAt(lexeme.Review.NextReviewAt)
	}

	rec, err := builder.Save(ctx)
	if err != nil {
		return nil, translateLearnedLexemeError(err)
	}
	return mapEntLearnedLexeme(rec), nil
}

func (r *LearnedLexemeRepository) Update(ctx context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
	listen, err := int32ToInt16(lexeme.Mastery.Listen, "mastery.listen")
	if err != nil {
		return nil, err
	}
	read, err := int32ToInt16(lexeme.Mastery.Read, "mastery.read")
	if err != nil {
		return nil, err
	}
	spell, err := int32ToInt16(lexeme.Mastery.Spell, "mastery.spell")
	if err != nil {
		return nil, err
	}
	pronounce, err := int32ToInt16(lexeme.Mastery.Pronounce, "mastery.pronounce")
	if err != nil {
		return nil, err
	}

	languageCode := entity.NormalizeLanguage(lexeme.Language).Code()

	mutation := r.client.LearnedLexeme.UpdateOneID(lexeme.ID).
		Where(entlearnedlexeme.UserIDEQ(lexeme.UserID)).
		SetLexemeExternalID(strings.TrimSpace(lexeme.LexemeExternalID)).
		SetDisplayTerm(strings.TrimSpace(lexeme.DisplayTerm)).
		SetLanguage(languageCode).
		SetTags(append([]string{}, lexeme.Tags...)).
		SetNote(strings.TrimSpace(lexeme.Note)).
		SetRelations(append([]entity.LearnedLexemeRelation{}, lexeme.Relations...)).
		SetFormStatus(copyFormStatus(lexeme.FormStatus)).
		SetMasteryListen(listen).
		SetMasteryRead(read).
		SetMasterySpell(spell).
		SetMasteryPronounce(pronounce).
		SetMasteryOverall(lexeme.Mastery.Overall).
		SetReviewIntervalDays(lexeme.Review.IntervalDays).
		SetReviewFailCount(lexeme.Review.FailCount).
		SetQueryCount(lexeme.QueryCount).
		SetCreatedBy(lexeme.CreatedBy).
		SetUpdatedAt(lexeme.UpdatedAt)

	if lexeme.LexemeID > 0 {
		mutation.SetLexemeID(lexeme.LexemeID)
	} else {
		mutation.ClearLexemeID()
	}

	if !lexeme.Review.LastReviewAt.IsZero() {
		mutation.SetReviewLastReviewAt(lexeme.Review.LastReviewAt)
	} else {
		mutation.ClearReviewLastReviewAt()
	}
	if !lexeme.Review.NextReviewAt.IsZero() {
		mutation.SetReviewNextReviewAt(lexeme.Review.NextReviewAt)
	} else {
		mutation.ClearReviewNextReviewAt()
	}

	rec, err := mutation.Save(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrLearnedLexemeNotFound
		}
		return nil, translateLearnedLexemeError(err)
	}

	return mapEntLearnedLexeme(rec), nil
}

func (r *LearnedLexemeRepository) GetByLexemeID(ctx context.Context, userID int64, lexemeID int64) (*entity.LearnedLexeme, error) {
	rec, err := r.client.LearnedLexeme.Query().
		Where(
			entlearnedlexeme.UserIDEQ(userID),
			entlearnedlexeme.LexemeIDEQ(lexemeID),
		).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrLearnedLexemeNotFound
		}
		return nil, fmt.Errorf("get user lexeme: %w", err)
	}
	return mapEntLearnedLexeme(rec), nil
}

func (r *LearnedLexemeRepository) FindByLexemeID(ctx context.Context, userID int64, lexemeID int64) (*entity.LearnedLexeme, error) {
	if lexemeID == 0 {
		return nil, nil
	}

	rec, err := r.client.LearnedLexeme.Query().
		Where(
			entlearnedlexeme.UserIDEQ(userID),
			entlearnedlexeme.LexemeIDEQ(lexemeID),
		).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("find user lexeme: %w", err)
	}
	return mapEntLearnedLexeme(rec), nil
}

func (r *LearnedLexemeRepository) List(ctx context.Context, query *repository.ListLearnedLexemeQuery) ([]entity.LearnedLexeme, int64, error) {
	var params listLearnedLexemesParams
	if err := filterexpr.Bind(query, &params, listLearnedLexemesSchema); err != nil {
		return nil, 0, err
	}

	qbuilder := r.client.LearnedLexeme.Query().
		Where(entlearnedlexeme.UserIDEQ(query.UserID))

	applyLearnedLexemeFilters(qbuilder, params)

	total, err := qbuilder.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count user lexemes: %w", err)
	}

	applyLearnedLexemeOrdering(qbuilder, params)

	offset := query.Offset()
	if offset > 0 {
		qbuilder.Offset(int(offset))
	}
	if query.PageSize > 0 {
		qbuilder.Limit(int(query.PageSize))
	}

	rows, err := qbuilder.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list user lexemes: %w", err)
	}

	results := make([]entity.LearnedLexeme, 0, len(rows))
	for _, row := range rows {
		if mapped := mapEntLearnedLexeme(row); mapped != nil {
			results = append(results, *mapped)
		}
	}

	return results, int64(total), nil
}

func (r *LearnedLexemeRepository) DeleteByLexemeID(ctx context.Context, userID int64, lexemeID int64) error {
	affected, err := r.client.LearnedLexeme.Delete().
		Where(
			entlearnedlexeme.UserIDEQ(userID),
			entlearnedlexeme.LexemeIDEQ(lexemeID),
		).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete user lexeme: %w", err)
	}
	if affected == 0 {
		return entity.ErrLearnedLexemeNotFound
	}
	return nil
}

func applyLearnedLexemeFilters(q *entdb.LearnedLexemeQuery, params listLearnedLexemesParams) {
	if params.Keyword != "" {
		q.Where(entlearnedlexeme.DisplayTermContainsFold(params.Keyword))
	}
	if len(params.LexemeIDs) > 0 {
		q.Where(entlearnedlexeme.LexemeIDIn(params.LexemeIDs...))
	}
	if tags := uniqueFolded(params.Tags); len(tags) > 0 {
		q.Where(func(s *sql.Selector) {
			column := s.C(entlearnedlexeme.FieldTags)
			for _, tag := range tags {
				s.Where(sqljson.ValueContains(column, tag))
			}
		})
	}
	if categories := uniqueFolded(params.Categories); len(categories) > 0 {
		q.Where(func(sel *sql.Selector) {
			// Join with lexemes to get word_id, then with words to check categories
			lex := sql.Table(entlexeme.Table)
			word := sql.Table(entword.Table)
			sub := sql.Select().
				From(lex).
				Join(word).On(lex.C(entlexeme.FieldWordID), word.C(entword.FieldID)).
				Where(sql.ColumnsEQ(
					lex.C(entlexeme.FieldID),
					sel.C(entlearnedlexeme.FieldLexemeID),
				))
			for _, category := range categories {
				sub.Where(sqljson.ValueContains(word.C(entword.FieldCategories), category))
			}
			sel.Where(sql.Exists(sub))
		})
	}
}

func applyLearnedLexemeOrdering(q *entdb.LearnedLexemeQuery, params listLearnedLexemesParams) {
	for _, term := range []struct {
		key  string
		desc bool
	}{
		{key: params.PrimaryKey, desc: params.PrimaryDesc},
		{key: params.SecondaryKey, desc: params.SecondaryDesc},
	} {
		if term.key == "" {
			continue
		}
		switch term.key {
		case "created_at":
			if term.desc {
				q.Order(entlearnedlexeme.ByCreatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlearnedlexeme.ByCreatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "updated_at":
			if term.desc {
				q.Order(entlearnedlexeme.ByUpdatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlearnedlexeme.ByUpdatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "display_term":
			if term.desc {
				q.Order(entlearnedlexeme.ByDisplayTerm(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlearnedlexeme.ByDisplayTerm(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "mastery_overall":
			if term.desc {
				q.Order(entlearnedlexeme.ByMasteryOverall(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlearnedlexeme.ByMasteryOverall(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "id":
			if term.desc {
				q.Order(entlearnedlexeme.ByID(sql.OrderDesc()))
			} else {
				q.Order(entlearnedlexeme.ByID())
			}
		}
	}

	q.Order(entlearnedlexeme.ByID())
}

func mapEntLearnedLexeme(rec *entdb.LearnedLexeme) *entity.LearnedLexeme {
	if rec == nil {
		return nil
	}

	out := &entity.LearnedLexeme{
		ID:               rec.ID,
		UserID:           rec.UserID,
		LexemeExternalID: rec.LexemeExternalID,
		DisplayTerm:      rec.DisplayTerm,
		Language:         entity.ParseLanguage(rec.Language),
		Mastery: entity.MasteryBreakdown{
			Listen:    int32(rec.MasteryListen),
			Read:      int32(rec.MasteryRead),
			Spell:     int32(rec.MasterySpell),
			Pronounce: int32(rec.MasteryPronounce),
			Overall:   rec.MasteryOverall,
		},
		Review: entity.ReviewTiming{
			IntervalDays: rec.ReviewIntervalDays,
			FailCount:    rec.ReviewFailCount,
		},
		QueryCount: rec.QueryCount,
		Tags:       append([]string{}, rec.Tags...),
		Note:       rec.Note,
		Relations:  append([]entity.LearnedLexemeRelation{}, rec.Relations...),
		FormStatus: copyFormStatus(rec.FormStatus),
		CreatedBy:  rec.CreatedBy,
		CreatedAt:  rec.CreatedAt,
		UpdatedAt:  rec.UpdatedAt,
	}

	if rec.LexemeID != nil {
		out.LexemeID = *rec.LexemeID
	}

	if rec.ReviewLastReviewAt != nil {
		out.Review.LastReviewAt = *rec.ReviewLastReviewAt
	}
	if rec.ReviewNextReviewAt != nil {
		out.Review.NextReviewAt = *rec.ReviewNextReviewAt
	}

	return out
}

func copyFormStatus(src map[string]entity.FormMastery) map[string]entity.FormMastery {
	if len(src) == 0 {
		return map[string]entity.FormMastery{}
	}
	dst := make(map[string]entity.FormMastery, len(src))
	for key, val := range src {
		dst[key] = val
	}
	return dst
}

// Deprecated: Use translateDBError from errors.go instead
func translateLearnedLexemeError(err error) error {
	return translateDBError(err, "learned_lexeme")
}

package repository

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqljson"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlearnedword "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/learnedword"
	entlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	entlexemeform "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexemeform"
	entword "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/word"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/pkg/filterexpr"
)

type LearnedWordRepository struct {
	client *entdb.Client
}

// NewLearnedWordRepository constructs an ent-backed repository.
func NewLearnedWordRepository(client *entdb.Client) repository.LearnedWordRepository {
	return &LearnedWordRepository{client: client}
}

type listLearnedWordsParams struct {
	Keyword       string
	WordIDs       []int64
	SurfaceTerms  []string
	Tags          []string
	Categories    []string
	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

func (r *LearnedWordRepository) Create(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
	listen, err := int32ToInt16(word.Mastery.Listen, "mastery.listen")
	if err != nil {
		return nil, err
	}
	read, err := int32ToInt16(word.Mastery.Read, "mastery.read")
	if err != nil {
		return nil, err
	}
	spell, err := int32ToInt16(word.Mastery.Spell, "mastery.spell")
	if err != nil {
		return nil, err
	}
	pronounce, err := int32ToInt16(word.Mastery.Pronounce, "mastery.pronounce")
	if err != nil {
		return nil, err
	}

	languageCode := entity.NormalizeLanguage(word.Language).Code()

	builder := r.client.LearnedWord.Create().
		SetUserID(word.UserID).
		SetWordID(word.WordID).
		SetDisplayTerm(strings.TrimSpace(word.DisplayTerm)).
		SetLanguage(languageCode).
		SetTags(append([]string{}, word.Tags...)).
		SetNote(strings.TrimSpace(word.Note)).
		SetRelations(append([]entity.LearnedWordRelation{}, word.Relations...)).
		SetContexts(append([]entity.LearnedWordContext{}, word.Contexts...)).
		SetMasteryListen(listen).
		SetMasteryRead(read).
		SetMasterySpell(spell).
		SetMasteryPronounce(pronounce).
		SetMasteryOverall(word.Mastery.Overall).
		SetReviewIntervalDays(word.Review.IntervalDays).
		SetReviewFailCount(word.Review.FailCount).
		SetQueryCount(word.QueryCount).
		SetCreatedBy(word.CreatedBy).
		SetCreatedAt(word.CreatedAt).
		SetUpdatedAt(word.UpdatedAt)

	if !word.Review.LastReviewAt.IsZero() {
		builder.SetReviewLastReviewAt(word.Review.LastReviewAt)
	}
	if !word.Review.NextReviewAt.IsZero() {
		builder.SetReviewNextReviewAt(word.Review.NextReviewAt)
	}

	rec, err := builder.Save(ctx)
	if err != nil {
		return nil, translateLearnedWordError(err)
	}
	return mapEntLearnedWord(rec), nil
}

func (r *LearnedWordRepository) Update(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
	listen, err := int32ToInt16(word.Mastery.Listen, "mastery.listen")
	if err != nil {
		return nil, err
	}
	read, err := int32ToInt16(word.Mastery.Read, "mastery.read")
	if err != nil {
		return nil, err
	}
	spell, err := int32ToInt16(word.Mastery.Spell, "mastery.spell")
	if err != nil {
		return nil, err
	}
	pronounce, err := int32ToInt16(word.Mastery.Pronounce, "mastery.pronounce")
	if err != nil {
		return nil, err
	}

	languageCode := entity.NormalizeLanguage(word.Language).Code()

	mutation := r.client.LearnedWord.UpdateOneID(word.ID).
		Where(entlearnedword.UserIDEQ(word.UserID)).
		SetWordID(word.WordID).
		SetDisplayTerm(strings.TrimSpace(word.DisplayTerm)).
		SetLanguage(languageCode).
		SetTags(append([]string{}, word.Tags...)).
		SetNote(strings.TrimSpace(word.Note)).
		SetRelations(append([]entity.LearnedWordRelation{}, word.Relations...)).
		SetContexts(append([]entity.LearnedWordContext{}, word.Contexts...)).
		SetMasteryListen(listen).
		SetMasteryRead(read).
		SetMasterySpell(spell).
		SetMasteryPronounce(pronounce).
		SetMasteryOverall(word.Mastery.Overall).
		SetReviewIntervalDays(word.Review.IntervalDays).
		SetReviewFailCount(word.Review.FailCount).
		SetQueryCount(word.QueryCount).
		SetCreatedBy(word.CreatedBy).
		SetUpdatedAt(word.UpdatedAt)

	if !word.Review.LastReviewAt.IsZero() {
		mutation.SetReviewLastReviewAt(word.Review.LastReviewAt)
	} else {
		mutation.ClearReviewLastReviewAt()
	}
	if !word.Review.NextReviewAt.IsZero() {
		mutation.SetReviewNextReviewAt(word.Review.NextReviewAt)
	} else {
		mutation.ClearReviewNextReviewAt()
	}

	rec, err := mutation.Save(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrLearnedWordNotFound
		}
		return nil, translateLearnedWordError(err)
	}

	return mapEntLearnedWord(rec), nil
}

func (r *LearnedWordRepository) GetByWordID(ctx context.Context, userID int64, wordID int64) (*entity.LearnedWord, error) {
	rec, err := r.client.LearnedWord.Query().
		Where(
			entlearnedword.UserIDEQ(userID),
			entlearnedword.WordIDEQ(wordID),
		).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrLearnedWordNotFound
		}
		return nil, fmt.Errorf("get user word: %w", err)
	}
	return mapEntLearnedWord(rec), nil
}

func (r *LearnedWordRepository) FindByWordID(ctx context.Context, userID int64, wordID int64) (*entity.LearnedWord, error) {
	if wordID == 0 {
		return nil, nil
	}

	rec, err := r.client.LearnedWord.Query().
		Where(
			entlearnedword.UserIDEQ(userID),
			entlearnedword.WordIDEQ(wordID),
		).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("find user word: %w", err)
	}
	return mapEntLearnedWord(rec), nil
}

func (r *LearnedWordRepository) List(ctx context.Context, query *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
	var params listLearnedWordsParams
	if err := filterexpr.Bind(query, &params, listLearnedWordsSchema); err != nil {
		return nil, 0, err
	}

	qbuilder := r.client.LearnedWord.Query().
		Where(entlearnedword.UserIDEQ(query.UserID))

	applyLearnedWordFilters(qbuilder, params)

	total, err := qbuilder.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count user words: %w", err)
	}

	applyLearnedWordOrdering(qbuilder, params)

	offset := query.Offset()
	if offset > 0 {
		qbuilder.Offset(int(offset))
	}
	if query.PageSize > 0 {
		qbuilder.Limit(int(query.PageSize))
	}

	rows, err := qbuilder.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list user words: %w", err)
	}

	results := make([]entity.LearnedWord, 0, len(rows))
	for _, row := range rows {
		if mapped := mapEntLearnedWord(row); mapped != nil {
			results = append(results, *mapped)
		}
	}

	return results, int64(total), nil
}

func (r *LearnedWordRepository) DeleteByWordID(ctx context.Context, userID int64, wordID int64) error {
	affected, err := r.client.LearnedWord.Delete().
		Where(
			entlearnedword.UserIDEQ(userID),
			entlearnedword.WordIDEQ(wordID),
		).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete user word: %w", err)
	}
	if affected == 0 {
		return entity.ErrLearnedWordNotFound
	}
	return nil
}

func applyLearnedWordFilters(q *entdb.LearnedWordQuery, params listLearnedWordsParams) {
	if params.Keyword != "" {
		q.Where(entlearnedword.DisplayTermContainsFold(params.Keyword))
	}
	if len(params.WordIDs) > 0 {
		q.Where(entlearnedword.WordIDIn(params.WordIDs...))
	}
	if surfaces := uniqueFolded(params.SurfaceTerms); len(surfaces) > 0 {
		// Batch lookup: match learned words by their word's lemma OR any of their forms
		// Use ent's edge predicates for clean join handling
		q.Where(
			entlearnedword.HasWordWith(
				entword.Or(
					// Match lemma (case-insensitive using LOWER() function)
					func(s *sql.Selector) {
						s.Where(sql.In(sql.Lower(s.C(entword.FieldLemma)), stringsToInterfaces(surfaces)...))
					},
					// Match any lexeme form (forms are already stored in lowercase)
					entword.HasLexemesWith(
						entlexeme.HasFormsWith(
							entlexemeform.TextIn(surfaces...),
						),
					),
				),
			),
		)
	}
	if tags := uniqueFolded(params.Tags); len(tags) > 0 {
		q.Where(func(s *sql.Selector) {
			column := s.C(entlearnedword.FieldTags)
			for _, tag := range tags {
				s.Where(sqljson.ValueContains(column, tag))
			}
		})
	}
	if categories := uniqueFolded(params.Categories); len(categories) > 0 {
		q.Where(func(sel *sql.Selector) {
			// Join with words to check categories
			word := sql.Table(entword.Table)
			sub := sql.Select().
				From(word).
				Where(sql.ColumnsEQ(
					word.C(entword.FieldID),
					sel.C(entlearnedword.FieldWordID),
				))
			for _, category := range categories {
				sub.Where(sqljson.ValueContains(word.C(entword.FieldCategories), category))
			}
			sel.Where(sql.Exists(sub))
		})
	}
}

func applyLearnedWordOrdering(q *entdb.LearnedWordQuery, params listLearnedWordsParams) {
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
				q.Order(entlearnedword.ByCreatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlearnedword.ByCreatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "updated_at":
			if term.desc {
				q.Order(entlearnedword.ByUpdatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlearnedword.ByUpdatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "display_term":
			if term.desc {
				q.Order(entlearnedword.ByDisplayTerm(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlearnedword.ByDisplayTerm(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "mastery_overall":
			if term.desc {
				q.Order(entlearnedword.ByMasteryOverall(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlearnedword.ByMasteryOverall(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "id":
			if term.desc {
				q.Order(entlearnedword.ByID(sql.OrderDesc()))
			} else {
				q.Order(entlearnedword.ByID())
			}
		}
	}

	q.Order(entlearnedword.ByID())
}

func mapEntLearnedWord(rec *entdb.LearnedWord) *entity.LearnedWord {
	if rec == nil {
		return nil
	}

	out := &entity.LearnedWord{
		ID:          rec.ID,
		UserID:      rec.UserID,
		WordID:      rec.WordID,
		DisplayTerm: rec.DisplayTerm,
		Language:    entity.ParseLanguage(rec.Language),
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
		Relations:  append([]entity.LearnedWordRelation{}, rec.Relations...),
		Contexts:   append([]entity.LearnedWordContext{}, rec.Contexts...),
		CreatedBy:  rec.CreatedBy,
		CreatedAt:  rec.CreatedAt,
		UpdatedAt:  rec.UpdatedAt,
	}

	if rec.ReviewLastReviewAt != nil {
		out.Review.LastReviewAt = *rec.ReviewLastReviewAt
	}
	if rec.ReviewNextReviewAt != nil {
		out.Review.NextReviewAt = *rec.ReviewNextReviewAt
	}

	return out
}

func translateLearnedWordError(err error) error {
	return translateDBError(err, "learned_word")
}

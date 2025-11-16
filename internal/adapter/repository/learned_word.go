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
	"github.com/eslsoft/vocnet/internal/repository"
)

type LearnedWordRepository struct {
	client *entdb.Client
}

// NewLearnedWordRepository constructs an ent-backed repository.
func NewLearnedWordRepository(client *entdb.Client) repository.LearnedWordRepository {
	return &LearnedWordRepository{
		client: client,
	}
}

func (r *LearnedWordRepository) Create(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
	languageCode := entity.NormalizeLanguage(word.Language).Code()
	builder := r.client.LearnedWord.Create().
		SetUserID(word.UserID).
		SetTerm(strings.TrimSpace(word.Term)).
		SetCaseSensitive(word.CaseSensitive).
		SetLanguage(languageCode).
		SetTags(append([]string{}, word.Tags...)).
		SetNotes(word.Notes).
		SetRelations(append([]entity.LearnedWordRelation{}, word.Relations...)).
		SetContexts(append([]entity.LearnedWordContext{}, word.Contexts...)).
		SetMasteryListen(word.Mastery.Listen).
		SetMasteryRead(word.Mastery.Read).
		SetMasterySpell(word.Mastery.Spell).
		SetMasteryPronounce(word.Mastery.Pronounce).
		SetMasteryOverall(word.Mastery.Overall).
		SetReviewIntervalDays(word.Review.IntervalDays).
		SetReviewFailCount(word.Review.FailCount).
		SetQueryCount(word.QueriedCount).
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
	languageCode := entity.NormalizeLanguage(word.Language).Code()
	mutation := r.client.LearnedWord.UpdateOneID(word.ID).
		Where(entlearnedword.UserIDEQ(word.UserID)).
		SetTerm(strings.TrimSpace(word.Term)).
		SetCaseSensitive(word.CaseSensitive).
		SetLanguage(languageCode).
		SetTags(append([]string{}, word.Tags...)).
		SetNotes(word.Notes).
		SetRelations(append([]entity.LearnedWordRelation{}, word.Relations...)).
		SetContexts(append([]entity.LearnedWordContext{}, word.Contexts...)).
		SetMasteryListen(word.Mastery.Listen).
		SetMasteryRead(word.Mastery.Read).
		SetMasterySpell(word.Mastery.Spell).
		SetMasteryPronounce(word.Mastery.Pronounce).
		SetMasteryOverall(word.Mastery.Overall).
		SetReviewIntervalDays(word.Review.IntervalDays).
		SetReviewFailCount(word.Review.FailCount).
		SetQueryCount(word.QueriedCount).
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

func (r *LearnedWordRepository) GetByID(ctx context.Context, userID int64, id int64) (*entity.LearnedWord, error) {
	rec, err := r.client.LearnedWord.Query().
		Where(
			entlearnedword.IDEQ(id),
			entlearnedword.UserIDEQ(userID),
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

func (r *LearnedWordRepository) FindByTerm(ctx context.Context, userID int64, term string, language entity.Language) (*entity.LearnedWord, error) {
	if term == "" {
		return nil, nil
	}

	languageCode := entity.NormalizeLanguage(language).Code()
	rec, err := r.client.LearnedWord.Query().
		Where(
			entlearnedword.UserIDEQ(userID),
			entlearnedword.TermEQ(strings.TrimSpace(term)),
			entlearnedword.LanguageEQ(languageCode),
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
	// Note: Filter parsing and SurfaceTerms mapping is done in connectrpc and usecase layers
	// Repository just applies the already-processed parameters

	qbuilder := r.client.LearnedWord.Query().
		Where(entlearnedword.UserIDEQ(query.UserID))

	// Apply filters from query parameters
	if query.Keyword != "" {
		qbuilder.Where(entlearnedword.TermContainsFold(query.Keyword))
	}
	if query.Language != "" {
		qbuilder.Where(entlearnedword.LanguageEQ(query.Language))
	}
	if surfaces := uniqueFolded(query.SurfaceTerms); len(surfaces) > 0 {
		// Convert to lowercase for case-insensitive matching
		lowerTerms := make([]string, len(surfaces))
		for i, term := range surfaces {
			lowerTerms[i] = strings.ToLower(term)
		}
		// Use LOWER(term) IN (...) for case-insensitive matching
		qbuilder.Where(func(s *sql.Selector) {
			s.Where(sql.In(sql.Lower(s.C(entlearnedword.FieldTerm)), stringsToInterfaces(lowerTerms)...))
		})
	}
	if tags := uniqueFolded(query.Tags); len(tags) > 0 {
		qbuilder.Where(func(s *sql.Selector) {
			column := s.C(entlearnedword.FieldTags)
			for _, tag := range tags {
				s.Where(sqljson.ValueContains(column, tag))
			}
		})
	}

	total, err := qbuilder.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count user words: %w", err)
	}

	// Apply ordering from parsed parameters
	applyLearnedWordOrdering(qbuilder, query)

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

func (r *LearnedWordRepository) DeleteByID(ctx context.Context, userID int64, id int64) error {
	affected, err := r.client.LearnedWord.Delete().
		Where(
			entlearnedword.IDEQ(id),
			entlearnedword.UserIDEQ(userID),
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

func translateLearnedWordError(err error) error {
	return translateDBError(err, "learned_word")
}

func applyLearnedWordOrdering(qb *entdb.LearnedWordQuery, query *repository.ListLearnedWordQuery) {
	for _, term := range []struct {
		key  string
		desc bool
	}{
		{key: query.PrimaryKey, desc: query.PrimaryDesc},
		{key: query.SecondaryKey, desc: query.SecondaryDesc},
	} {
		if term.key == "" {
			continue
		}
		switch term.key {
		case "created_at":
			if term.desc {
				qb.Order(entlearnedword.ByCreatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				qb.Order(entlearnedword.ByCreatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "updated_at":
			if term.desc {
				qb.Order(entlearnedword.ByUpdatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				qb.Order(entlearnedword.ByUpdatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "term":
			if term.desc {
				qb.Order(entlearnedword.ByTerm(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				qb.Order(entlearnedword.ByTerm(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "mastery_overall":
			if term.desc {
				qb.Order(entlearnedword.ByMasteryOverall(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				qb.Order(entlearnedword.ByMasteryOverall(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "id":
			if term.desc {
				qb.Order(entlearnedword.ByID(sql.OrderDesc()))
			} else {
				qb.Order(entlearnedword.ByID())
			}
		}
	}

	qb.Order(entlearnedword.ByID())
}

func mapEntLearnedWord(rec *entdb.LearnedWord) *entity.LearnedWord {
	if rec == nil {
		return nil
	}

	out := &entity.LearnedWord{
		ID:            rec.ID,
		UserID:        rec.UserID,
		Term:          rec.Term,
		CaseSensitive: rec.CaseSensitive,
		Language:      entity.ParseLanguage(rec.Language),
		Mastery: entity.MasteryBreakdown{
			Listen:    rec.MasteryListen,
			Read:      rec.MasteryRead,
			Spell:     rec.MasterySpell,
			Pronounce: rec.MasteryPronounce,
			Overall:   rec.MasteryOverall,
		},
		Review: entity.ReviewTiming{
			IntervalDays: rec.ReviewIntervalDays,
			FailCount:    rec.ReviewFailCount,
		},
		QueriedCount: rec.QueryCount,
		Tags:         append([]string{}, rec.Tags...),
		Notes:        rec.Notes,
		Relations:    append([]entity.LearnedWordRelation{}, rec.Relations...),
		Contexts:     append([]entity.LearnedWordContext{}, rec.Contexts...),
		CreatedBy:    rec.CreatedBy,
		CreatedAt:    rec.CreatedAt,
		UpdatedAt:    rec.UpdatedAt,
	}

	if rec.ReviewLastReviewAt != nil {
		out.Review.LastReviewAt = *rec.ReviewLastReviewAt
	}
	if rec.ReviewNextReviewAt != nil {
		out.Review.NextReviewAt = *rec.ReviewNextReviewAt
	}

	return out
}

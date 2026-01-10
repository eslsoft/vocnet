package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqljson"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlearnedword "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/learnedword"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/pkg/safeconv"
	"github.com/google/uuid"
)

type LearnedWordRepository struct {
	client       *entdb.Client
	wordbookRepo repository.WordbookRepository
}

// NewLearnedWordRepository constructs an ent-backed repository.
func NewLearnedWordRepository(client *entdb.Client, wordbookRepo repository.WordbookRepository) repository.LearnedWordRepository {
	return &LearnedWordRepository{
		client:       client,
		wordbookRepo: wordbookRepo,
	}
}

func (r *LearnedWordRepository) Create(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
	languageCode := entity.NormalizeLanguage(word.Language).Code()
	builder := r.client.LearnedWord.Create().
		SetUserID(word.UserID).
		SetLexemeID(word.LexemeID).
		SetTerm(strings.TrimSpace(word.Term)).
		SetNormal(word.Normal).
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
		SetReviewReps(word.Review.Reps).
		SetQueryCount(word.QueriedCount).
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
		return nil, translateDBError(err, "learned_word")
	}
	return mapEntLearnedWord(rec), nil
}

func (r *LearnedWordRepository) Update(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
	languageCode := entity.NormalizeLanguage(word.Language).Code()
	mutation := r.client.LearnedWord.UpdateOneID(word.ID).
		Where(entlearnedword.UserIDEQ(word.UserID)).
		SetLexemeID(word.LexemeID).
		SetTerm(strings.TrimSpace(word.Term)).
		SetNormal(word.Normal).
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
		SetReviewReps(word.Review.Reps).
		SetQueryCount(word.QueriedCount).
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
		return nil, translateDBError(err, "learned_word")
	}

	return mapEntLearnedWord(rec), nil
}

func (r *LearnedWordRepository) GetByID(ctx context.Context, userID uuid.UUID, id int64) (*entity.LearnedWord, error) {
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

func (r *LearnedWordRepository) FindByLexeme(ctx context.Context, userID uuid.UUID, lexemeID string, normal string) (*entity.LearnedWord, error) {
	if lexemeID == "" || normal == "" {
		return nil, nil
	}

	rec, err := r.client.LearnedWord.Query().
		Where(
			entlearnedword.UserIDEQ(userID),
			entlearnedword.LexemeIDEQ(lexemeID),
			entlearnedword.NormalEQ(normal),
		).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("find user word by lexeme and normal: %w", err)
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
		keyword := strings.ToLower(strings.TrimSpace(query.Keyword))
		qbuilder.Where(entlearnedword.NormalContains(keyword))
	}
	if query.Language != "" {
		qbuilder.Where(entlearnedword.LanguageEQ(query.Language))
	}
	if len(query.SurfaceTerms) > 0 {
		lowerTerms := make([]string, 0, len(query.SurfaceTerms))
		for _, term := range query.SurfaceTerms {
			lowerTerms = append(lowerTerms, strings.ToLower(strings.TrimSpace(term)))
		}
		qbuilder.Where(entlearnedword.NormalIn(lowerTerms...))
	}
	if tags := uniqueFolded(query.Tags); len(tags) > 0 {
		qbuilder.Where(func(s *sql.Selector) {
			column := s.C(entlearnedword.FieldTags)
			for _, tag := range tags {
				s.Where(sqljson.ValueContains(column, tag))
			}
		})
	}

	applyLearnedWordOrdering(qbuilder, query)

	// Fetch rows with appropriate pagination strategy
	var rows []*entdb.LearnedWord
	var total int64
	var err error

	if len(query.SurfaceTerms) > 0 {
		// SurfaceTerms: fetch all, filter exact matches, paginate in-memory
		rows, err = qbuilder.All(ctx)
		if err != nil {
			return nil, 0, fmt.Errorf("list user words: %w", err)
		}
		rows = filterExactMatches(rows, query.SurfaceTerms)
		total = int64(len(rows))
	} else {
		// Normal query: count + paginate at DB level
		count, err := qbuilder.Clone().Count(ctx)
		if err != nil {
			return nil, 0, fmt.Errorf("count user words: %w", err)
		}
		total = int64(count)
		if offset := query.Offset(); offset > 0 {
			qbuilder.Offset(int(offset))
		}
		if query.PageSize > 0 {
			qbuilder.Limit(int(query.PageSize))
		}
		rows, err = qbuilder.All(ctx)
		if err != nil {
			return nil, 0, fmt.Errorf("list user words: %w", err)
		}
	}

	results := make([]entity.LearnedWord, 0, len(rows))
	for _, row := range rows {
		if mapped := mapEntLearnedWord(row); mapped != nil {
			results = append(results, *mapped)
		}
	}

	return results, total, nil
}

// findExactMatch finds the record that strictly matches the term.
func findExactMatch(rows []*entdb.LearnedWord, exactTerm string) *entdb.LearnedWord {
	for _, row := range rows {
		if row.Term == exactTerm {
			return row
		}
	}
	return nil
}

func filterExactMatches(rows []*entdb.LearnedWord, surfaceTerms []string) []*entdb.LearnedWord {
	surfaceSet := make(map[string]struct{}, len(surfaceTerms))
	for _, term := range surfaceTerms {
		surfaceSet[strings.TrimSpace(term)] = struct{}{}
	}

	filtered := make([]*entdb.LearnedWord, 0, len(rows))
	for _, row := range rows {
		if _, exactMatch := surfaceSet[row.Term]; exactMatch {
			filtered = append(filtered, row)
		}
	}
	return filtered
}

func (r *LearnedWordRepository) DeleteByID(ctx context.Context, userID uuid.UUID, id int64) error {
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

// StatsByTerms aggregates mastery buckets for the provided terms.
func (r *LearnedWordRepository) StatsByTerms(ctx context.Context, userID uuid.UUID, terms []string, endOfToday time.Time) (entity.WordbookStats, error) {
	if userID == uuid.Nil || len(terms) == 0 {
		return entity.WordbookStats{}, nil
	}

	// Use exact deduplication for total count to match wordbook contents
	uniqueTerms := unique(terms)
	if len(uniqueTerms) == 0 {
		return entity.WordbookStats{}, nil
	}

	// Collect lowercased terms for database query
	lowerTerms := make([]string, 0, len(uniqueTerms))
	for _, term := range uniqueTerms {
		trimmed := strings.TrimSpace(term)
		if trimmed != "" {
			lowerTerms = append(lowerTerms, strings.ToLower(trimmed))
		}
	}

	// Query by normal field to support case-insensitive matching
	rows, err := r.client.LearnedWord.Query().
		Where(
			entlearnedword.UserIDEQ(userID),
			entlearnedword.NormalIn(lowerTerms...),
		).
		Select(entlearnedword.FieldTerm, entlearnedword.FieldNormal,
			entlearnedword.FieldMasteryOverall, entlearnedword.FieldReviewNextReviewAt).
		All(ctx)
	if err != nil {
		return entity.WordbookStats{}, fmt.Errorf("aggregate wordbook stats: %w", err)
	}

	// Group by normal for lookup
	grouped := make(map[string][]*entdb.LearnedWord)
	for _, row := range rows {
		grouped[row.Normal] = append(grouped[row.Normal], row)
	}

	stats := entity.WordbookStats{TotalWords: safeconv.IntToInt32(len(uniqueTerms))}

	for _, term := range uniqueTerms {
		trimmed := strings.TrimSpace(term)
		if trimmed == "" {
			continue
		}

		candidates := grouped[strings.ToLower(trimmed)]
		// Use the same exact match logic as FindByTerm
		best := findExactMatch(candidates, trimmed)

		if best == nil {
			fmt.Println(candidates, trimmed)
			stats.UnknownWords++
			continue
		}

		if best.ReviewNextReviewAt != nil && entity.IsReviewDue(*best.ReviewNextReviewAt, endOfToday) {
			stats.ReviewDue++
		}

		switch {
		case best.MasteryOverall >= 418:
			stats.MasteredWords++
		case best.MasteryOverall >= 126:
			stats.LearningWords++
		default:
			stats.UnknownWords++
		}
	}

	return stats, nil
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
		ID:       rec.ID,
		UserID:   rec.UserID,
		LexemeID: rec.LexemeID,
		Term:     rec.Term,
		Normal:   rec.Normal,
		Language: entity.ParseLanguage(rec.Language),
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
			Reps:         rec.ReviewReps,
		},
		QueriedCount: rec.QueryCount,
		Tags:         append([]string{}, rec.Tags...),
		Notes:        rec.Notes,
		Relations:    append([]entity.LearnedWordRelation{}, rec.Relations...),
		Contexts:     append([]entity.LearnedWordContext{}, rec.Contexts...),
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

// GetByReviewPlan fetches words associated with a review plan's wordbooks.
func (r *LearnedWordRepository) GetByReviewPlan(ctx context.Context, userID uuid.UUID,
	wordbookIDs []int64, dueOnly bool, limit int) ([]*entity.LearnedWord, error) {

	if len(wordbookIDs) == 0 {
		return []*entity.LearnedWord{}, nil
	}

	// Step 1: Fetch all wordbooks to get their terms
	if r.wordbookRepo == nil {
		return nil, fmt.Errorf("wordbook repository not available")
	}

	wordbooks, err := r.wordbookRepo.GetByIDs(ctx, wordbookIDs, userID)
	if err != nil {
		return nil, err
	}

	// Step 2: Extract and deduplicate all terms
	allTerms := make(map[string]struct{})
	for _, wb := range wordbooks {
		for _, term := range wb.Terms {
			trimmed := strings.TrimSpace(term)
			if trimmed != "" {
				allTerms[trimmed] = struct{}{}
			}
		}
	}

	if len(allTerms) == 0 {
		return []*entity.LearnedWord{}, nil
	}

	termsSlice := make([]string, 0, len(allTerms))
	for term := range allTerms {
		termsSlice = append(termsSlice, term)
	}

	// Step 3: Query LearnedWords
	uniqueTerms := uniqueFolded(termsSlice)
	qb := r.client.LearnedWord.Query().
		Where(
			entlearnedword.UserIDEQ(userID),
			func(s *sql.Selector) {
				s.Where(sql.In(sql.Lower(s.C(entlearnedword.FieldTerm)), stringsToInterfaces(uniqueTerms)...))
			},
		)

	if dueOnly {
		now := time.Now()
		qb.Where(func(s *sql.Selector) {
			// next_review_at <= now OR next_review_at IS NULL
			s.Where(sql.Or(
				sql.LTE(s.C(entlearnedword.FieldReviewNextReviewAt), now),
				sql.IsNull(s.C(entlearnedword.FieldReviewNextReviewAt)),
			))
		})
	}

	if limit > 0 {
		qb.Limit(limit)
	}

	rows, err := qb.All(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]*entity.LearnedWord, 0, len(rows))
	for _, row := range rows {
		result = append(result, mapEntLearnedWord(row))
	}

	return result, nil
}

// UpdateMasteryAndReview atomically updates mastery scores and review timing.
func (r *LearnedWordRepository) UpdateMasteryAndReview(ctx context.Context, id int64,
	userID uuid.UUID, mastery entity.MasteryBreakdown, review entity.ReviewTiming) error {

	mutation := r.client.LearnedWord.UpdateOneID(id).
		Where(entlearnedword.UserIDEQ(userID)).
		SetMasteryListen(mastery.Listen).
		SetMasteryRead(mastery.Read).
		SetMasterySpell(mastery.Spell).
		SetMasteryPronounce(mastery.Pronounce).
		SetMasteryOverall(mastery.Overall).
		SetReviewIntervalDays(review.IntervalDays).
		SetReviewFailCount(review.FailCount).
		SetReviewReps(review.Reps).
		SetUpdatedAt(time.Now())

	if !review.LastReviewAt.IsZero() {
		mutation.SetReviewLastReviewAt(review.LastReviewAt)
	}
	if !review.NextReviewAt.IsZero() {
		mutation.SetReviewNextReviewAt(review.NextReviewAt)
	}

	_, err := mutation.Save(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return entity.ErrLearnedWordNotFound
		}
		return err
	}

	return nil
}

// GetByIDs fetches multiple words by their IDs.
func (r *LearnedWordRepository) GetByIDs(ctx context.Context, userID uuid.UUID,
	ids []int64) ([]*entity.LearnedWord, error) {

	if len(ids) == 0 {
		return []*entity.LearnedWord{}, nil
	}

	rows, err := r.client.LearnedWord.Query().
		Where(
			entlearnedword.UserIDEQ(userID),
			entlearnedword.IDIn(ids...),
		).
		All(ctx)

	if err != nil {
		return nil, err
	}

	result := make([]*entity.LearnedWord, 0, len(rows))
	for _, row := range rows {
		result = append(result, mapEntLearnedWord(row))
	}

	return result, nil
}

// CountByUser returns the total number of learned words for a user.
func (r *LearnedWordRepository) CountByUser(ctx context.Context, userID uuid.UUID) (int32, error) {
	count, err := r.client.LearnedWord.Query().
		Where(entlearnedword.UserIDEQ(userID)).
		Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("count user words: %w", err)
	}
	return safeconv.IntToInt32(count), nil
}

// CountMasteredByUser returns the count of words with mastery >= masteryThreshold.
func (r *LearnedWordRepository) CountMasteredByUser(ctx context.Context, userID uuid.UUID, masteryThreshold int32) (int32, error) {
	count, err := r.client.LearnedWord.Query().
		Where(
			entlearnedword.UserIDEQ(userID),
			entlearnedword.MasteryOverallGTE(masteryThreshold),
		).
		Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("count mastered words: %w", err)
	}
	return safeconv.IntToInt32(count), nil
}

// CountDueToday returns the count of words due for review (NextReviewAt <= endOfToday).
func (r *LearnedWordRepository) CountDueToday(ctx context.Context, userID uuid.UUID, endOfToday time.Time) (int32, error) {
	count, err := r.client.LearnedWord.Query().
		Where(entlearnedword.UserIDEQ(userID)).
		Where(func(s *sql.Selector) {
			// next_review_at <= endOfToday OR next_review_at IS NULL
			s.Where(sql.Or(
				sql.LTE(s.C(entlearnedword.FieldReviewNextReviewAt), endOfToday),
				sql.IsNull(s.C(entlearnedword.FieldReviewNextReviewAt)),
			))
		}).
		Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("count due words: %w", err)
	}
	return safeconv.IntToInt32(count), nil
}

// GetMasteryDistribution returns a map of mastery level (0-5) to word count.
// Converts overall scores (0-500) to mastery levels using entity.MasteryBreakdown.CalculateMasteryLevel().
func (r *LearnedWordRepository) GetMasteryDistribution(ctx context.Context, userID uuid.UUID) (map[int32]int32, error) {
	var results []struct {
		MasteryOverall int32 `json:"mastery_overall"`
		Count          int   `json:"count"`
	}

	err := r.client.LearnedWord.Query().
		Where(entlearnedword.UserIDEQ(userID)).
		GroupBy(entlearnedword.FieldMasteryOverall).
		Aggregate(func(s *sql.Selector) string {
			return sql.As(sql.Count("*"), "count")
		}).
		Scan(ctx, &results)

	if err != nil {
		return nil, fmt.Errorf("get mastery distribution: %w", err)
	}

	// Convert overall scores to mastery levels
	distribution := make(map[int32]int32)
	for _, result := range results {
		level := int32(entity.MasteryLevelFromOverall(result.MasteryOverall))
		distribution[level] += safeconv.IntToInt32(result.Count)
	}

	return distribution, nil
}

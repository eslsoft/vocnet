package repository

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqljson"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	entlexemeform "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexemeform"
	entpredicate "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/predicate"
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

func (r *wordGroupRepository) Create(ctx context.Context, group *entity.Word) (*entity.Word, error) {
	if group == nil || strings.TrimSpace(group.WID) == "" {
		return nil, fmt.Errorf("word wid required")
	}
	if strings.TrimSpace(group.Lemma) == "" {
		return nil, fmt.Errorf("word lemma required")
	}

	rec, err := r.client.Word.Create().
		SetWid(strings.TrimSpace(group.WID)).
		SetLemma(strings.TrimSpace(group.Lemma)).
		SetLanguage(group.Language.CodeOrDefault()).
		SetPhonetics(append([]entity.Phonetic{}, group.Phonetics...)).
		SetCategories(append([]string{}, group.Categories...)).
		SetCompleteness(group.Completeness).
		Save(ctx)
	if err != nil {
		return nil, translateDBError(err, "word")
	}
	return mapEntWord(rec), nil
}

func (r *wordGroupRepository) Update(ctx context.Context, group *entity.Word) (*entity.Word, error) {
	if group == nil || group.ID == 0 {
		return nil, fmt.Errorf("word id required")
	}
	if strings.TrimSpace(group.Lemma) == "" {
		return nil, fmt.Errorf("word lemma required")
	}

	rec, err := r.client.Word.UpdateOneID(group.ID).
		SetLemma(strings.TrimSpace(group.Lemma)).
		SetLanguage(group.Language.CodeOrDefault()).
		SetPhonetics(append([]entity.Phonetic{}, group.Phonetics...)).
		SetCategories(append([]string{}, group.Categories...)).
		SetCompleteness(group.Completeness).
		Save(ctx)
	if err != nil {
		return nil, translateDBError(err, "word")
	}
	return mapEntWord(rec), nil
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
		return nil, translateDBError(err, "word")
	}
	return mapEntWord(rec), nil
}

func (r *wordGroupRepository) GetByWID(ctx context.Context, wid string) (*entity.Word, error) {
	rec, err := r.client.Word.Query().
		Where(entword.WidEQ(strings.TrimSpace(wid))).
		First(ctx)
	if err != nil {
		return nil, translateDBError(err, "word")
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

func (r *wordGroupRepository) Delete(ctx context.Context, wordID int64) error {
	if wordID == 0 {
		return fmt.Errorf("word id required")
	}

	// Delete word (Lexeme.word_id will be set to NULL automatically via ON DELETE SET NULL)
	err := r.client.Word.DeleteOneID(wordID).Exec(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return entity.ErrWordNotFound
		}
		return fmt.Errorf("delete word: %w", err)
	}
	return nil
}

func (r *wordGroupRepository) DeleteByWID(ctx context.Context, wid string) error {
	if strings.TrimSpace(wid) == "" {
		return fmt.Errorf("word wid required")
	}

	// Delete word (Lexeme.word_id will be set to NULL automatically via ON DELETE SET NULL)
	affected, err := r.client.Word.Delete().
		Where(entword.WidEQ(strings.TrimSpace(wid))).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete word by wid: %w", err)
	}
	if affected == 0 {
		return entity.ErrWordNotFound
	}
	return nil
}

type listWordGroupParams struct {
	Language      string
	Keyword       string
	Categories    []string
	SurfaceTerms  []string
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
		// Keyword search: match in lemma OR in any lexeme forms
		// This allows searching "apples" to find "apple"
		q.Where(entword.Or(
			entword.LemmaContainsFold(params.Keyword),
			entword.HasLexemesWith(
				entlexeme.HasFormsWith(
					entlexemeform.TextContainsFold(params.Keyword),
				),
			),
		))
	}
	if len(params.Categories) > 0 {
		// OR logic: word contains ANY of the specified categories
		q.Where(func(s *sql.Selector) {
			column := s.C(entword.FieldCategories)
			predicates := make([]*sql.Predicate, 0, len(params.Categories))
			for _, category := range params.Categories {
				predicates = append(predicates, sqljson.ValueContains(column, category))
			}
			s.Where(sql.Or(predicates...))
		})
	}
	if len(params.SurfaceTerms) > 0 {
		// Batch lookup: match words by lemma OR any of their forms
		// Use IN operator for better performance with large lists

		// Convert to lowercase for case-insensitive matching
		lowerTerms := make([]string, len(params.SurfaceTerms))
		for i, term := range params.SurfaceTerms {
			lowerTerms[i] = strings.ToLower(term)
		}

		q.Where(entword.Or(
			// Match lemma (case-insensitive using LOWER() function)
			func(s *sql.Selector) {
				s.Where(sql.In(sql.Lower(s.C(entword.FieldLemma)), stringsToInterfaces(lowerTerms)...))
			},
			// Match any lexeme form (forms are already stored in lowercase)
			entword.HasLexemesWith(
				entlexeme.HasFormsWith(
					entlexemeform.TextIn(lowerTerms...),
				),
			),
		))
	}
}

// Helper function to convert []string to []interface{} for SQL IN clause
func stringsToInterfaces(strs []string) []interface{} {
	result := make([]interface{}, len(strs))
	for i, s := range strs {
		result[i] = s
	}
	return result
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
	case "created_at":
		if params.PrimaryDesc {
			q.Order(entword.ByCreatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
		} else {
			q.Order(entword.ByCreatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
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
		case "created_at":
			if params.SecondaryDesc {
				q.Order(entword.ByCreatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entword.ByCreatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
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

func (r *wordGroupRepository) ListCategories(ctx context.Context, search string) ([]string, error) {
	rows, err := r.client.Word.
		Query().
		Select(entword.FieldCategories).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}

	normalizedSearch := strings.ToLower(strings.TrimSpace(search))
	seen := make(map[string]struct{})
	var out []string

	for _, row := range rows {
		for _, category := range row.Categories {
			trimmed := strings.TrimSpace(category)
			if trimmed == "" {
				continue
			}
			if normalizedSearch != "" && !strings.Contains(strings.ToLower(trimmed), normalizedSearch) {
				continue
			}
			if _, ok := seen[trimmed]; ok {
				continue
			}
			seen[trimmed] = struct{}{}
			out = append(out, trimmed)
		}
	}

	sort.Strings(out)
	return out, nil
}

func (r *wordGroupRepository) Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error) {
	langCodes := normalizeLanguageCodes(filter)
	words, err := r.loadWordsForStats(ctx, langCodes)
	if err != nil {
		return nil, err
	}

	stats := &entity.WordStats{
		Completeness: initCompletenessBuckets(),
	}

	langAcc := make(map[string]*languageAccumulator)
	if filter != nil {
		for _, lang := range filter.Languages {
			ensureLanguageAccumulator(langAcc, lang)
		}
	}

	wordIndex := make(map[int64]*languageAccumulator, len(words))
	categoryTallies := newCategoryTallies()

	var (
		sumCompleteness   int64
		wordsWithPhonetic int64
		wordsWithCategory int64
		newLast24h        int64
		newLast7d         int64
	)

	now := time.Now().UTC()
	last24h := now.Add(-24 * time.Hour)
	last7d := now.Add(-7 * 24 * time.Hour)

	for _, w := range words {
		lang := entity.ParseLanguage(w.Language)
		acc := ensureLanguageAccumulator(langAcc, lang)
		wordIndex[w.ID] = acc

		acc.WordCount++
		acc.CompletenessSum += int64(w.Completeness)
		sumCompleteness += int64(w.Completeness)

		if len(w.Phonetics) > 0 {
			acc.PhoneticWords++
			wordsWithPhonetic++
		}
		if len(w.Categories) > 0 {
			acc.CategoryWords++
			wordsWithCategory++
		}
		categoryTallies.AddMany(w.Categories)

		incrementCompletenessBucket(stats.Completeness, w.Completeness)

		if !w.CreatedAt.IsZero() {
			if w.CreatedAt.After(last24h) {
				newLast24h++
			}
			if w.CreatedAt.After(last7d) {
				newLast7d++
			}
		}
	}

	totalWords := int64(len(words))
	stats.Summary.TotalWords = totalWords
	stats.Summary.NewLast24h = newLast24h
	stats.Summary.NewLast7d = newLast7d
	if totalWords > 0 {
		stats.Summary.AvgCompleteness = float64(sumCompleteness) / float64(totalWords)
	}

	stats.TopCategories = categoryTallies.Top(maxCategoryStats)

	lexemeRows := []struct {
		Language string `json:"language"`
		Count    int64  `json:"count"`
	}{}
	lexemeQuery := r.client.Lexeme.Query().
		Where(entlexeme.WordIDNotNil())
	if len(langCodes) > 0 {
		lexemeQuery = lexemeQuery.Where(entlexeme.LanguageIn(langCodes...))
	}
	if err := lexemeQuery.
		GroupBy(entlexeme.FieldLanguage).
		Aggregate(entdb.As(entdb.Count(), "count")).
		Scan(ctx, &lexemeRows); err != nil {
		return nil, fmt.Errorf("count lexemes: %w", err)
	}

	for _, row := range lexemeRows {
		stats.Summary.TotalLexemes += row.Count
		acc := ensureLanguageAccumulator(langAcc, entity.ParseLanguage(row.Language))
		acc.LexemeCount = row.Count
	}

	formQuery := r.client.LexemeForm.Query().
		Where(entlexemeform.HasLexemeWith(entlexeme.WordIDNotNil()))
	if len(langCodes) > 0 {
		formQuery = formQuery.Where(entlexemeform.HasLexemeWith(entlexeme.LanguageIn(langCodes...)))
	}
	formTotal, err := formQuery.Count(ctx)
	if err != nil {
		return nil, fmt.Errorf("count lexeme forms: %w", err)
	}
	stats.Summary.TotalForms = int64(formTotal)

	definitionWords, err := r.collectLexemeWordIDs(ctx, langCodes, entpredicate.Lexeme(func(sel *sql.Selector) {
		sel.Where(sqljson.LenGT(entlexeme.FieldSenses, 0))
	}))
	if err != nil {
		return nil, fmt.Errorf("collect definition coverage: %w", err)
	}
	for wordID := range definitionWords {
		if acc := wordIndex[wordID]; acc != nil {
			acc.WordsWithSenses++
		}
	}

	formWords, err := r.collectLexemeWordIDs(ctx, langCodes, entlexeme.HasForms())
	if err != nil {
		return nil, fmt.Errorf("collect form coverage: %w", err)
	}
	for wordID := range formWords {
		if acc := wordIndex[wordID]; acc != nil {
			acc.WordsWithForms++
		}
	}

	stats.Coverage.Phonetics = ratio(wordsWithPhonetic, totalWords)
	stats.Coverage.Categories = ratio(wordsWithCategory, totalWords)
	stats.Coverage.Definitions = ratio(int64(len(definitionWords)), totalWords)
	stats.Coverage.Forms = ratio(int64(len(formWords)), totalWords)

	stats.Languages = buildLanguageStats(langAcc)

	return stats, nil
}

func mapEntWord(rec *entdb.Word) *entity.Word {
	if rec == nil {
		return nil
	}
	parsedLang := entity.ParseLanguage(rec.Language)
	return &entity.Word{
		ID:           rec.ID,
		WID:          rec.Wid,
		Lemma:        rec.Lemma,
		Language:     parsedLang,
		Phonetics:    append([]entity.Phonetic{}, rec.Phonetics...),
		Categories:   append([]string{}, rec.Categories...),
		Completeness: rec.Completeness,
		CreatedAt:    rec.CreatedAt,
		UpdatedAt:    rec.UpdatedAt,
	}
}

const (
	maxCategoryStats   = 10
	unknownLanguageKey = "und"
)

var completenessBucketConfig = []struct {
	label string
	min   int32
	max   int32
}{
	{label: "missing", min: 0, max: 0},
	{label: "forms_only", min: 1, max: 59},
	{label: "definitions", min: 60, max: 99},
	{label: "complete", min: 100, max: 100},
}

type languageAccumulator struct {
	Language        entity.Language
	WordCount       int64
	CompletenessSum int64
	PhoneticWords   int64
	CategoryWords   int64
	WordsWithSenses int64
	WordsWithForms  int64
	LexemeCount     int64
}

func (a *languageAccumulator) toStats() entity.WordLanguageStats {
	stats := entity.WordLanguageStats{
		Language:    a.Language,
		WordCount:   a.WordCount,
		LexemeCount: a.LexemeCount,
	}
	if a.WordCount > 0 {
		stats.AvgCompleteness = float64(a.CompletenessSum) / float64(a.WordCount)
		stats.PhoneticCoverage = ratio(a.PhoneticWords, a.WordCount)
		stats.CategoryCoverage = ratio(a.CategoryWords, a.WordCount)
		stats.DefinitionCoverage = ratio(a.WordsWithSenses, a.WordCount)
		stats.FormCoverage = ratio(a.WordsWithForms, a.WordCount)
	}
	return stats
}

func ensureLanguageAccumulator(acc map[string]*languageAccumulator, lang entity.Language) *languageAccumulator {
	normalized := normalizeLanguageValue(lang)
	key := languageKey(normalized)
	if entry, ok := acc[key]; ok {
		return entry
	}
	entry := &languageAccumulator{
		Language: normalized,
	}
	acc[key] = entry
	return entry
}

func normalizeLanguageValue(lang entity.Language) entity.Language {
	code := strings.TrimSpace(lang.Code())
	if code == "" {
		return entity.LanguageUnspecified
	}
	return entity.ParseLanguage(code)
}

func languageKey(lang entity.Language) string {
	code := strings.TrimSpace(lang.Code())
	if code == "" {
		return unknownLanguageKey
	}
	return code
}

func buildLanguageStats(acc map[string]*languageAccumulator) []entity.WordLanguageStats {
	stats := make([]entity.WordLanguageStats, 0, len(acc))
	for _, a := range acc {
		stats = append(stats, a.toStats())
	}
	sort.Slice(stats, func(i, j int) bool {
		if stats[i].WordCount == stats[j].WordCount {
			return stats[i].Language.Code() < stats[j].Language.Code()
		}
		return stats[i].WordCount > stats[j].WordCount
	})
	return stats
}

type categoryTallies map[string]*categoryTally

type categoryTally struct {
	label string
	count int64
}

func newCategoryTallies() categoryTallies {
	return make(categoryTallies)
}

func (c categoryTallies) AddMany(categories []string) {
	for _, raw := range categories {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		entry, ok := c[key]
		if !ok {
			entry = &categoryTally{label: trimmed}
			c[key] = entry
		}
		entry.count++
	}
}

func (c categoryTallies) Top(limit int) []entity.CategoryStat {
	stats := make([]entity.CategoryStat, 0, len(c))
	for _, tally := range c {
		stats = append(stats, entity.CategoryStat{
			Category: tally.label,
			Count:    tally.count,
		})
	}
	sort.Slice(stats, func(i, j int) bool {
		if stats[i].Count == stats[j].Count {
			return stats[i].Category < stats[j].Category
		}
		return stats[i].Count > stats[j].Count
	})
	if limit > 0 && len(stats) > limit {
		return stats[:limit]
	}
	return stats
}

func initCompletenessBuckets() []entity.CompletenessBucket {
	buckets := make([]entity.CompletenessBucket, len(completenessBucketConfig))
	for i, cfg := range completenessBucketConfig {
		buckets[i] = entity.CompletenessBucket{
			Label: cfg.label,
			Min:   cfg.min,
			Max:   cfg.max,
		}
	}
	return buckets
}

func incrementCompletenessBucket(buckets []entity.CompletenessBucket, score int32) {
	for i := range buckets {
		if score >= buckets[i].Min && score <= buckets[i].Max {
			buckets[i].Count++
			return
		}
	}
	if len(buckets) > 0 {
		buckets[len(buckets)-1].Count++
	}
}

func ratio(num, den int64) float64 {
	if den == 0 {
		return 0
	}
	return float64(num) / float64(den)
}

func normalizeLanguageCodes(filter *entity.WordStatsFilter) []string {
	if filter == nil || len(filter.Languages) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(filter.Languages))
	codes := make([]string, 0, len(filter.Languages))
	for _, lang := range filter.Languages {
		code := strings.TrimSpace(lang.Code())
		if code == "" {
			continue
		}
		lower := strings.ToLower(code)
		if _, ok := seen[lower]; ok {
			continue
		}
		seen[lower] = struct{}{}
		codes = append(codes, lower)
	}
	return codes
}

func (r *wordGroupRepository) loadWordsForStats(ctx context.Context, langCodes []string) ([]*entdb.Word, error) {
	query := r.client.Word.Query()
	if len(langCodes) > 0 {
		query = query.Where(entword.LanguageIn(langCodes...))
	}
	words, err := query.
		Select(
			entword.FieldID,
			entword.FieldLanguage,
			entword.FieldCategories,
			entword.FieldPhonetics,
			entword.FieldCompleteness,
			entword.FieldCreatedAt,
		).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list words for stats: %w", err)
	}
	return words, nil
}

func (r *wordGroupRepository) collectLexemeWordIDs(ctx context.Context, langCodes []string, preds ...entpredicate.Lexeme) (map[int64]struct{}, error) {
	query := r.client.Lexeme.Query().
		Where(entlexeme.WordIDNotNil())
	if len(langCodes) > 0 {
		query = query.Where(entlexeme.LanguageIn(langCodes...))
	}
	for _, pred := range preds {
		query = query.Where(pred)
	}
	ids, err := query.
		GroupBy(entlexeme.FieldWordID).
		Ints(ctx)
	if err != nil {
		return nil, err
	}
	results := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		results[int64(id)] = struct{}{}
	}
	return results, nil
}

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
	entlemma "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"
	entlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	entlexemeform "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexemeform"
	"github.com/eslsoft/vocnet/internal/repository"
)

type lemmaRepository struct {
	client *entdb.Client
}

// NewLemmaRepository constructs an ent-backed lemma repository.
func NewLemmaRepository(client *entdb.Client) repository.LemmaRepository {
	return &lemmaRepository{client: client}
}

// Write operations removed per user request

func (r *lemmaRepository) GetByID(ctx context.Context, lemmaID int64) (*entity.Lemma, error) {
	if lemmaID == 0 {
		return nil, entity.ErrInvalidInput
	}

	lemmaRow, err := r.client.Lemma.Query().
		Where(entlemma.IDEQ(lemmaID)).
		WithForms().
		First(ctx)
	if err != nil {
		return nil, translateDBError(err, "lemma")
	}

	return mapEntLemma(lemmaRow), nil
}

func (r *lemmaRepository) LookupByForm(ctx context.Context, surface string, language entity.Language) (*entity.Lemma, error) {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return nil, entity.ErrInvalidInput
	}

	normalized := strings.ToLower(surface)
	langCode := language.CodeOrDefault()

	// First, try to find a form that matches this surface
	formRow, err := r.client.LexemeForm.Query().
		Where(entlexemeform.NormalizedEQ(normalized)).
		Where(entlexemeform.HasLemmaWith(
			entlemma.HasLexemeWith(entlexeme.LanguageCodeEQ(langCode)),
		)).
		WithLemma(func(q *entdb.LemmaQuery) {
			q.WithForms()
		}).
		First(ctx)

	if err == nil {
		lemmaRow, err := formRow.Edges.LemmaOrErr()
		if err == nil {
			return mapEntLemma(lemmaRow), nil
		}
	}

	// If no form found, return not found error
	return nil, entity.ErrWordNotFound
}

func (r *lemmaRepository) ListByFormNormalized(ctx context.Context, surface string, language entity.Language) ([]*entity.Lemma, error) {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return nil, entity.ErrInvalidInput
	}

	normalized := strings.ToLower(surface)
	langCode := language.CodeOrDefault()

	formRows, err := r.client.LexemeForm.Query().
		Where(entlexemeform.NormalizedEQ(normalized)).
		Where(entlexemeform.HasLemmaWith(
			entlemma.HasLexemeWith(entlexeme.LanguageCodeEQ(langCode)),
		)).
		WithLemma(func(q *entdb.LemmaQuery) {
			q.WithForms()
		}).
		All(ctx)
	if err != nil {
		return nil, translateDBError(err, "lemma")
	}

	if len(formRows) == 0 {
		return nil, entity.ErrWordNotFound
	}

	seen := make(map[int64]struct{}, len(formRows))
	out := make([]*entity.Lemma, 0, len(formRows))
	for _, formRow := range formRows {
		lemmaRow, err := formRow.Edges.LemmaOrErr()
		if err != nil {
			continue
		}
		if _, ok := seen[lemmaRow.ID]; ok {
			continue
		}
		seen[lemmaRow.ID] = struct{}{}
		out = append(out, mapEntLemma(lemmaRow))
	}

	if len(out) == 0 {
		return nil, entity.ErrWordNotFound
	}

	return out, nil
}

func (r *lemmaRepository) List(ctx context.Context, query *repository.ListWordsQuery) ([]*entity.Lemma, int64, error) {
	if query == nil {
		query = &repository.ListWordsQuery{}
	}

	q := r.client.Lemma.Query().WithForms().WithLexeme()
	applyLemmaFilters(q, query)

	// Get total count before pagination
	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count lemmas: %w", err)
	}

	// Apply pagination
	if query.PageSize > 0 {
		q = q.Limit(int(query.PageSize)).Offset(int(query.Offset()))
	}

	// Apply ordering
	if query.PrimaryDesc {
		q = q.Order(entlemma.ByUpdatedAt(sql.OrderDesc()))
	} else {
		q = q.Order(entlemma.ByUpdatedAt())
	}

	lemmas, err := q.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list lemmas: %w", err)
	}

	out := make([]*entity.Lemma, 0, len(lemmas))
	for _, lemmaRow := range lemmas {
		out = append(out, mapEntLemma(lemmaRow))
	}

	return out, int64(total), nil
}

// DeleteByWID removed per user request (write operations disabled)

func (r *lemmaRepository) ListCategories(ctx context.Context, search string) ([]string, error) {
	rows, err := r.client.Lexeme.Query().
		Select(entlexeme.FieldCategories).
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

func (r *lemmaRepository) Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error) {
	langCodes := normalizeLanguageCodes(filter)

	lemmas, lexemeRows, err := r.loadStatsRows(ctx, langCodes)
	if err != nil {
		return nil, err
	}

	lemmaIDs := collectLemmaIDs(lemmas)
	formLemmaIDs, phoneticLemmaIDs, err := r.loadFormLemmaIDs(ctx, lemmaIDs)
	if err != nil {
		return nil, err
	}

	stats := &entity.WordStats{
		Completeness: initCompletenessBuckets(),
	}

	groups := groupLemmaRows(lemmas)
	wordCount := int64(len(groups))

	stats.Summary.TotalWords = wordCount
	stats.Summary.TotalLexemes = int64(len(lexemeRows))

	stats.Summary.AvgCompleteness = averageCompleteness(lexemeRows)
	acc := r.accumulateWordStats(stats, groups, lexemeRows, formLemmaIDs, phoneticLemmaIDs, filter)

	stats.Coverage = entity.WordCoverage{
		Phonetics:   ratio(acc.phoneticWords, wordCount),
		Categories:  ratio(acc.categoryWords, wordCount),
		Definitions: ratio(acc.definitionWords, wordCount),
		Forms:       ratio(acc.formWords, wordCount),
	}

	stats.Languages = buildLanguageStats(acc.langAcc)
	stats.TopCategories = topCategoryStats(acc.categoryCounts)

	formCount, err := r.countForms(ctx, langCodes)
	if err != nil {
		return nil, err
	}
	stats.Summary.TotalForms = int64(formCount)

	return stats, nil
}

func (r *lemmaRepository) ResolveLemmaSurfacesByLexemeExternalIDs(ctx context.Context, externalIDs []string, language entity.Language) (map[string]string, error) {
	out := make(map[string]string)
	if len(externalIDs) == 0 {
		return out, nil
	}
	langCode := entity.NormalizeLanguage(language).Code()

	ids := make([]string, 0, len(externalIDs))
	seen := make(map[string]struct{}, len(externalIDs))
	for _, id := range externalIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		ids = append(ids, trimmed)
	}
	if len(ids) == 0 {
		return out, nil
	}

	// Load all lemmas for the target lexemes and pick the best display lemma per lexeme.
	// Prefer is_primary=true, otherwise fall back to the first seen.
	rows, err := r.client.Lemma.Query().
		Where(entlemma.HasLexemeWith(
			entlexeme.LanguageCodeEQ(langCode),
			entlexeme.ExternalIDIn(ids...),
		)).
		WithLexeme().
		All(ctx)
	if err != nil {
		return nil, translateDBError(err, "lemma")
	}

	for _, row := range rows {
		if row == nil {
			continue
		}
		lex, err := row.Edges.LexemeOrErr()
		if err != nil || lex == nil {
			continue
		}
		extID := lex.ExternalID
		if extID == "" {
			continue
		}
		// If we already have a primary lemma picked, keep it.
		if _, ok := out[extID]; ok {
			// Only replace if current row is primary and existing selection isn't.
			// Since we don't track the previous selection's primary-ness, we handle it
			// by only overwriting when row.IsPrimary is true.
			if row.IsPrimary {
				out[extID] = row.Surface
			}
			continue
		}
		out[extID] = row.Surface
	}

	return out, nil
}

type wordStatsAccumulator struct {
	langAcc         map[string]*languageAccumulator
	categoryCounts  map[string]int64
	phoneticWords   int64
	categoryWords   int64
	definitionWords int64
	formWords       int64
}

func (r *lemmaRepository) loadStatsRows(ctx context.Context, langCodes []string) ([]*entdb.Lemma, []*entdb.Lexeme, error) {
	lemmaQuery := r.client.Lemma.Query().WithLexeme()
	if len(langCodes) > 0 {
		lemmaQuery = lemmaQuery.Where(entlemma.HasLexemeWith(entlexeme.LanguageCodeIn(langCodes...)))
	}
	lemmas, err := lemmaQuery.All(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("list lemmas for stats: %w", err)
	}

	lexemeQuery := r.client.Lexeme.Query()
	if len(langCodes) > 0 {
		lexemeQuery = lexemeQuery.Where(entlexeme.LanguageCodeIn(langCodes...))
	}
	lexemes, err := lexemeQuery.All(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("list lexemes for stats: %w", err)
	}

	return lemmas, lexemes, nil
}

func (r *lemmaRepository) loadFormLemmaIDs(ctx context.Context, lemmaIDs []int64) (map[int64]struct{}, map[int64]struct{}, error) {
	formLemmaIDs := make(map[int64]struct{})
	phoneticLemmaIDs := make(map[int64]struct{})
	if len(lemmaIDs) == 0 {
		return formLemmaIDs, phoneticLemmaIDs, nil
	}

	forms, err := r.client.LexemeForm.Query().
		Where(entlexemeform.LemmaIDIn(lemmaIDs...)).
		All(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("list forms for stats: %w", err)
	}
	for _, form := range forms {
		formLemmaIDs[form.LemmaID] = struct{}{}
		if len(form.Phonetics) > 0 {
			phoneticLemmaIDs[form.LemmaID] = struct{}{}
		}
	}

	return formLemmaIDs, phoneticLemmaIDs, nil
}

func collectLemmaIDs(lemmas []*entdb.Lemma) []int64 {
	lemmaIDs := make([]int64, 0, len(lemmas))
	for _, lemma := range lemmas {
		lemmaIDs = append(lemmaIDs, lemma.ID)
	}
	return lemmaIDs
}

func averageCompleteness(lexemeRows []*entdb.Lexeme) float64 {
	if len(lexemeRows) == 0 {
		return 0
	}
	var completenessTotal int64
	for _, lex := range lexemeRows {
		completenessTotal += int64(lex.Completeness)
	}
	return float64(completenessTotal) / float64(len(lexemeRows))
}

func (r *lemmaRepository) accumulateWordStats(
	stats *entity.WordStats,
	groups map[string]*lemmaGroup,
	lexemeRows []*entdb.Lexeme,
	formLemmaIDs map[int64]struct{},
	phoneticLemmaIDs map[int64]struct{},
	filter *entity.WordStatsFilter,
) wordStatsAccumulator {
	now := time.Now()
	window24 := now.Add(-24 * time.Hour)
	window7d := now.Add(-7 * 24 * time.Hour)

	acc := wordStatsAccumulator{
		langAcc:        initializeLanguageAcc(filter),
		categoryCounts: make(map[string]int64),
	}

	for _, group := range groups {
		lexemeIDs := collectLexemeIDs(group.lemmas)
		if len(lexemeIDs) == 0 {
			continue
		}

		r.updateNewWordStats(stats, lexemeRows, lexemeIDs, window24, window7d)

		langAcc := ensureLanguageAccumulator(acc.langAcc, group.languageCode)
		langAcc.wordCount++

		lexemes := filterLexemesByIDs(lexemeRows, lexemeIDs)
		r.updateCompletenessStats(stats, langAcc, lexemes)
		r.updateCoverageStats(&acc, langAcc, lexemes, group.lemmas, formLemmaIDs, phoneticLemmaIDs)
	}

	return acc
}

func (r *lemmaRepository) updateNewWordStats(
	stats *entity.WordStats,
	lexemeRows []*entdb.Lexeme,
	lexemeIDs []int64,
	window24 time.Time,
	window7d time.Time,
) {
	createdAt := earliestLexemeCreatedAt(lexemeRows, lexemeIDs)
	if createdAt.IsZero() {
		return
	}
	if createdAt.After(window24) {
		stats.Summary.NewLast24h++
	}
	if createdAt.After(window7d) {
		stats.Summary.NewLast7d++
	}
}

func ensureLanguageAccumulator(langAcc map[string]*languageAccumulator, languageCode string) *languageAccumulator {
	acc := langAcc[languageCode]
	if acc != nil {
		return acc
	}
	acc = &languageAccumulator{language: entity.ParseLanguage(languageCode)}
	langAcc[languageCode] = acc
	return acc
}

func (r *lemmaRepository) updateCompletenessStats(
	stats *entity.WordStats,
	acc *languageAccumulator,
	lexemes []*entdb.Lexeme,
) {
	acc.lexemeCount += int64(len(lexemes))
	wordCompleteness := aggregateCompleteness(lexemes)
	acc.completenessTotal += int64(wordCompleteness)
	updateCompletenessBucket(stats.Completeness, wordCompleteness)
}

func (r *lemmaRepository) updateCoverageStats(
	acc *wordStatsAccumulator,
	langAcc *languageAccumulator,
	lexemes []*entdb.Lexeme,
	lemmas []*entdb.Lemma,
	formLemmaIDs map[int64]struct{},
	phoneticLemmaIDs map[int64]struct{},
) {
	if hasCategories(lexemes) {
		acc.categoryWords++
		for _, category := range uniqueCategories(lexemes) {
			acc.categoryCounts[category]++
		}
		langAcc.categoryWords++
	}
	if hasDefinitions(lexemes) {
		acc.definitionWords++
		langAcc.definitionWords++
	}
	if hasForms(lemmas, formLemmaIDs) {
		acc.formWords++
		langAcc.formWords++
	}
	if hasPhonetics(lemmas, phoneticLemmaIDs) {
		acc.phoneticWords++
		langAcc.phoneticWords++
	}
}

// mapEntLemma converts an ent Lemma (with forms) to entity.Lemma
func mapEntLemma(lemmaRow *entdb.Lemma) *entity.Lemma {
	if lemmaRow == nil {
		return nil
	}

	forms := make([]*entity.LemmaForm, 0, len(lemmaRow.Edges.Forms))
	for _, formRow := range lemmaRow.Edges.Forms {
		if formRow == nil {
			continue
		}
		forms = append(forms, &entity.LemmaForm{
			ID:          formRow.ID,
			LemmaID:     formRow.LemmaID,
			Surface:     formRow.Surface,
			Normalized:  formRow.Normalized,
			FormType:    entity.LexemeFormType(formRow.FormType),
			IsIrregular: formRow.IsIrregular,
			Phonetics:   formRow.Phonetics,
			Syllables:   formRow.Syllables,
			CreatedAt:   formRow.CreatedAt,
			UpdatedAt:   formRow.UpdatedAt,
		})
	}

	return &entity.Lemma{
		ID:         lemmaRow.ID,
		LexemeID:   fmt.Sprintf("%d", lemmaRow.LexemeID),
		Surface:    lemmaRow.Surface,
		Normalized: lemmaRow.Normalized,
		Variant:    lemmaRow.Variant,
		Forms:      forms,
		CreatedAt:  lemmaRow.CreatedAt,
		UpdatedAt:  lemmaRow.UpdatedAt,
	}
}

func applyLemmaFilters(q *entdb.LemmaQuery, params *repository.ListWordsQuery) {
	if params.Language == "" {
		params.Language = entity.LanguageEnglish.CodeOrDefault()
	}
	q.Where(entlemma.HasLexemeWith(entlexeme.LanguageCodeEQ(params.Language)))

	if params.Keyword != "" {
		keyword := strings.TrimSpace(params.Keyword)
		if keyword != "" {
			keywordLower := strings.ToLower(keyword)
			q.Where(entlemma.Or(
				entlemma.SurfaceContainsFold(keyword),
				entlemma.HasFormsWith(entlexemeform.NormalizedContains(keywordLower)),
			))
		}
	}

	if len(params.Categories) > 0 {
		categories := make([]string, 0, len(params.Categories))
		for _, category := range params.Categories {
			trimmed := strings.TrimSpace(category)
			if trimmed != "" {
				categories = append(categories, trimmed)
			}
		}
		if len(categories) > 0 {
			q.Where(entlemma.HasLexemeWith(func(s *sql.Selector) {
				column := s.C(entlexeme.FieldCategories)
				var preds []*sql.Predicate
				for _, category := range categories {
					preds = append(preds, sqljson.ValueContains(column, category))
				}
				s.Where(sql.Or(preds...))
			}))
		}
	}
}

type lemmaGroup struct {
	normalized   string
	languageCode string
	display      *entdb.Lemma
	lemmas       []*entdb.Lemma
}

func groupLemmaRows(lemmas []*entdb.Lemma) map[string]*lemmaGroup {
	groups := make(map[string]*lemmaGroup)
	for _, lemma := range lemmas {
		lexeme, err := lemma.Edges.LexemeOrErr()
		if err != nil {
			continue
		}
		key := lexeme.LanguageCode + ":" + lemma.Normalized
		group := groups[key]
		if group == nil {
			group = &lemmaGroup{
				normalized:   lemma.Normalized,
				languageCode: lexeme.LanguageCode,
				display:      lemma,
			}
			groups[key] = group
		}
		group.lemmas = append(group.lemmas, lemma)
		if shouldReplaceDisplay(group.display, lemma) {
			group.display = lemma
		}
	}
	return groups
}

func shouldReplaceDisplay(current *entdb.Lemma, candidate *entdb.Lemma) bool {
	if current == nil {
		return true
	}
	if candidate == nil {
		return false
	}
	if !current.IsPrimary && candidate.IsPrimary {
		return true
	}
	return false
}

func collectLexemeIDs(lemmas []*entdb.Lemma) []int64 {
	seen := make(map[int64]struct{})
	ids := make([]int64, 0, len(lemmas))
	for _, lemma := range lemmas {
		lexeme, err := lemma.Edges.LexemeOrErr()
		if err != nil {
			continue
		}
		if _, ok := seen[lexeme.ID]; ok {
			continue
		}
		seen[lexeme.ID] = struct{}{}
		ids = append(ids, lexeme.ID)
	}
	return ids
}

func filterLexemesByIDs(lexemes []*entdb.Lexeme, ids []int64) []*entdb.Lexeme {
	idSet := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	out := make([]*entdb.Lexeme, 0, len(ids))
	for _, lex := range lexemes {
		if _, ok := idSet[lex.ID]; ok {
			out = append(out, lex)
		}
	}
	return out
}

func earliestLexemeCreatedAt(lexemes []*entdb.Lexeme, ids []int64) time.Time {
	idSet := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	var earliest time.Time
	for _, lex := range lexemes {
		if _, ok := idSet[lex.ID]; !ok {
			continue
		}
		if earliest.IsZero() || lex.CreatedAt.Before(earliest) {
			earliest = lex.CreatedAt
		}
	}
	return earliest
}

func aggregateCompleteness(lexemes []*entdb.Lexeme) int32 {
	if len(lexemes) == 0 {
		return 0
	}
	var total int64
	for _, lex := range lexemes {
		total += int64(lex.Completeness)
	}
	return int32(total / int64(len(lexemes)))
}

func uniqueCategories(lexemes []*entdb.Lexeme) []string {
	seen := make(map[string]struct{})
	var out []string
	for _, lex := range lexemes {
		for _, category := range lex.Categories {
			trimmed := strings.TrimSpace(category)
			if trimmed == "" {
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
	return out
}

func hasCategories(lexemes []*entdb.Lexeme) bool {
	for _, lex := range lexemes {
		if len(lex.Categories) > 0 {
			return true
		}
	}
	return false
}

func hasDefinitions(lexemes []*entdb.Lexeme) bool {
	for _, lex := range lexemes {
		if len(lex.Senses) > 0 {
			return true
		}
	}
	return false
}

func hasForms(lemmas []*entdb.Lemma, formLemmaIDs map[int64]struct{}) bool {
	for _, lemma := range lemmas {
		if _, ok := formLemmaIDs[lemma.ID]; ok {
			return true
		}
	}
	return false
}

func hasPhonetics(lemmas []*entdb.Lemma, phoneticLemmaIDs map[int64]struct{}) bool {
	for _, lemma := range lemmas {
		if _, ok := phoneticLemmaIDs[lemma.ID]; ok {
			return true
		}
	}
	return false
}

func topCategoryStats(counts map[string]int64) []entity.CategoryStat {
	stats := make([]entity.CategoryStat, 0, len(counts))
	for category, count := range counts {
		stats = append(stats, entity.CategoryStat{Category: category, Count: count})
	}
	sort.Slice(stats, func(i, j int) bool {
		if stats[i].Count == stats[j].Count {
			return stats[i].Category < stats[j].Category
		}
		return stats[i].Count > stats[j].Count
	})
	return stats
}

func buildLanguageStats(acc map[string]*languageAccumulator) []entity.WordLanguageStats {
	out := make([]entity.WordLanguageStats, 0, len(acc))
	for _, item := range acc {
		if item.wordCount == 0 {
			continue
		}
		out = append(out, entity.WordLanguageStats{
			Language:           item.language,
			WordCount:          item.wordCount,
			LexemeCount:        item.lexemeCount,
			AvgCompleteness:    ratioFloat(item.completenessTotal, item.wordCount),
			PhoneticCoverage:   ratio(item.phoneticWords, item.wordCount),
			DefinitionCoverage: ratio(item.definitionWords, item.wordCount),
			FormCoverage:       ratio(item.formWords, item.wordCount),
			CategoryCoverage:   ratio(item.categoryWords, item.wordCount),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Language.CodeOrDefault() < out[j].Language.CodeOrDefault()
	})
	return out
}

func normalizeLanguageCodes(filter *entity.WordStatsFilter) []string {
	if filter == nil || len(filter.Languages) == 0 {
		return nil
	}
	codes := make([]string, 0, len(filter.Languages))
	for _, lang := range filter.Languages {
		code := entity.NormalizeLanguage(lang).CodeOrDefault()
		if code != "" {
			codes = append(codes, code)
		}
	}
	return codes
}

func (r *lemmaRepository) countForms(ctx context.Context, langCodes []string) (int, error) {
	query := r.client.LexemeForm.Query().
		Where(entlexemeform.HasLemmaWith(entlemma.HasLexemeWith(func(s *sql.Selector) {
			if len(langCodes) == 0 {
				return
			}
			s.Where(sql.In(s.C(entlexeme.FieldLanguageCode), stringsToInterfaces(langCodes)...))
		})))

	count, err := query.Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("count forms: %w", err)
	}
	return count, nil
}

func stringsToInterfaces(values []string) []interface{} {
	out := make([]interface{}, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

type languageAccumulator struct {
	language          entity.Language
	wordCount         int64
	lexemeCount       int64
	completenessTotal int64
	phoneticWords     int64
	definitionWords   int64
	formWords         int64
	categoryWords     int64
}

func initializeLanguageAcc(filter *entity.WordStatsFilter) map[string]*languageAccumulator {
	acc := make(map[string]*languageAccumulator)
	if filter == nil || len(filter.Languages) == 0 {
		return acc
	}
	for _, lang := range filter.Languages {
		code := entity.NormalizeLanguage(lang).CodeOrDefault()
		if code == "" {
			continue
		}
		acc[code] = &languageAccumulator{language: lang}
	}
	return acc
}

func ratio(numerator int64, denominator int64) float64 {
	if denominator == 0 {
		return 0
	}
	return float64(numerator) / float64(denominator)
}

func ratioFloat(numerator int64, denominator int64) float64 {
	if denominator == 0 {
		return 0
	}
	return float64(numerator) / float64(denominator)
}

func initCompletenessBuckets() []entity.CompletenessBucket {
	return []entity.CompletenessBucket{
		{Label: "empty", Min: 0, Max: 0},
		{Label: "forms_only", Min: 1, Max: 59},
		{Label: "definitions_only", Min: 60, Max: 89},
		{Label: "complete", Min: 90, Max: 100},
	}
}

func updateCompletenessBucket(buckets []entity.CompletenessBucket, value int32) {
	for i := range buckets {
		if value >= buckets[i].Min && value <= buckets[i].Max {
			buckets[i].Count++
			return
		}
	}
}

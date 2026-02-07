package repository

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlemma "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"
	entlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	entlexemeform "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexemeform"
	entpredicate "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/predicate"
	"github.com/eslsoft/vocnet/internal/repository"
)

type lexemeRepository struct {
	client *entdb.Client
}

// NewLexemeRepository constructs an ent-backed lexeme repository.
func NewLexemeRepository(client *entdb.Client) repository.LexemeRepository {
	return &lexemeRepository{client: client}
}

func (r *lexemeRepository) Create(ctx context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
	if lexeme == nil {
		return nil, entity.ErrInvalidInput
	}
	if lexeme.ExternalID == "" {
		return nil, entity.ErrInvalidInput
	}

	// Start transaction
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, fmt.Errorf("start transaction: %w", err)
	}
	defer func() {
		if v := recover(); v != nil {
			_ = tx.Rollback()
			panic(v)
		}
	}()

	// Create lexeme
	lexemeCreate := tx.Lexeme.Create().
		SetExternalID(lexeme.ExternalID).
		SetLanguageCode(lexeme.Language.CodeOrDefault()).
		SetPos(lexeme.PartOfSpeech).
		SetSenseGloss(lexeme.SenseGloss).
		SetSenses(lexeme.Senses).
		SetCategories(lexeme.Categories).
		SetCompleteness(lexeme.Completeness)

	if lexeme.EntryType != "" {
		lexemeCreate.SetEntryType(string(lexeme.EntryType))
	}
	if lexeme.Level != "" {
		lexemeCreate.SetLevel(lexeme.Level)
	}
	if len(lexeme.Frequencies) > 0 {
		lexemeCreate.SetFrequencies(lexeme.Frequencies)
	}

	lexemeRow, err := lexemeCreate.Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, translateDBError(err, "lexeme")
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	// Reload with edges
	return r.GetByID(ctx, lexemeRow.ID)
}

func (r *lexemeRepository) Update(ctx context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
	if lexeme == nil || lexeme.ID == 0 {
		return nil, entity.ErrInvalidInput
	}

	// Start transaction
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, fmt.Errorf("start transaction: %w", err)
	}
	defer func() {
		if v := recover(); v != nil {
			_ = tx.Rollback()
			panic(v)
		}
	}()

	// Update lexeme
	update := tx.Lexeme.UpdateOneID(lexeme.ID).
		SetLanguageCode(lexeme.Language.CodeOrDefault()).
		SetPos(lexeme.PartOfSpeech).
		SetSenseGloss(lexeme.SenseGloss).
		SetSenses(lexeme.Senses).
		SetCategories(lexeme.Categories).
		SetCompleteness(lexeme.Completeness)

	if lexeme.EntryType != "" {
		update.SetEntryType(string(lexeme.EntryType))
	}
	if lexeme.Level != "" {
		update.SetLevel(lexeme.Level)
	}
	if len(lexeme.Frequencies) > 0 {
		update.SetFrequencies(lexeme.Frequencies)
	}

	lexemeRow, err := update.Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, translateDBError(err, "lexeme")
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	// Reload with edges
	return r.GetByID(ctx, lexemeRow.ID)
}

func (r *lexemeRepository) GetByID(ctx context.Context, lexemeID int64) (*entity.Lexeme, error) {
	res, err := r.fetchAggregate(ctx, entlexeme.IDEQ(lexemeID))
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrLexemeNotFound
		}
		return nil, err
	}
	return res, nil
}

func (r *lexemeRepository) Lookup(ctx context.Context, surfaceForm string, language entity.Language) (*entity.Lexeme, error) {
	word := strings.TrimSpace(surfaceForm)
	if word == "" {
		return nil, entity.ErrInvalidLexemeText
	}
	wordLower := strings.ToLower(word)
	langCode := entity.NormalizeLanguage(language).Code()

	// Query all lexemes that have a form matching the word (case-insensitive)
	recs, err := r.client.Lexeme.Query().
		Where(
			entlexeme.LanguageCodeEQ(langCode),
			entlexeme.HasLemmasWith(
				entlemma.HasFormsWith(
					entlexemeform.NormalizedEQ(wordLower),
				),
			),
		).
		WithLemmas(func(q *entdb.LemmaQuery) {
			q.WithForms()
		}).
		All(ctx)
	if err != nil {
		return nil, translateDBError(err, "lexeme")
	}
	if len(recs) == 0 {
		return nil, entity.ErrLexemeNotFound
	}

	// Sort in application layer: prioritize exact case match
	// If multiple lexemes match, prefer the one with exact case match in forms
	for _, rec := range recs {
		for _, lemma := range rec.Edges.Lemmas {
			for _, form := range lemma.Edges.Forms {
				if form.Surface == word {
					return mapEntLexeme(rec), nil
				}
			}
		}
	}

	// No exact match, return first result
	return mapEntLexeme(recs[0]), nil
}

func (r *lexemeRepository) BatchLookupFormInfo(ctx context.Context, surfaceForms []string, language entity.Language) (map[string][]*repository.LexemeFormInfo, error) {
	if len(surfaceForms) == 0 {
		return make(map[string][]*repository.LexemeFormInfo), nil
	}

	langCode := entity.NormalizeLanguage(language).Code()

	// Trim and filter empty strings, convert to lowercase
	formTexts := make([]string, 0, len(surfaceForms))
	lowerFormTexts := make([]string, 0, len(surfaceForms))
	for _, sf := range surfaceForms {
		word := strings.TrimSpace(sf)
		if word == "" {
			continue
		}
		formTexts = append(formTexts, word)
		lowerFormTexts = append(lowerFormTexts, strings.ToLower(word))
	}

	if len(formTexts) == 0 {
		return make(map[string][]*repository.LexemeFormInfo), nil
	}

	// Batch query using normalized field (case-insensitive, indexed)
	forms, err := r.client.LexemeForm.Query().
		Where(entlexemeform.NormalizedIn(lowerFormTexts...)).
		WithLemma(func(q *entdb.LemmaQuery) {
			q.WithLexeme(func(lq *entdb.LexemeQuery) {
				lq.Where(entlexeme.LanguageCodeEQ(langCode))
			})
		}).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("batch lookup form info: %w", err)
	}

	// Build result map - collecting ALL forms per surface term (case-insensitive)
	result := make(map[string][]*repository.LexemeFormInfo)
	for _, form := range forms {
		lemma, err := form.Edges.LemmaOrErr()
		if err != nil {
			continue
		}
		lexeme, err := lemma.Edges.LexemeOrErr()
		if err != nil {
			continue
		}

		info := &repository.LexemeFormInfo{
			LexemeID:    lexeme.ID,
			FormText:    form.Surface,
			FormType:    form.FormType,
			IsIrregular: form.IsIrregular,
			LemmaText:   lemma.Surface,
			Pos:         lexeme.Pos,
		}

		// Map back to original surface forms (case-insensitive comparison using normalized)
		for _, original := range formTexts {
			if form.Normalized == strings.ToLower(original) {
				result[original] = append(result[original], info)
			}
		}
	}

	return result, nil
}

func (r *lexemeRepository) List(ctx context.Context, query *repository.ListLexemeQuery) ([]*entity.Lexeme, int64, error) {
	q := r.client.Lexeme.Query()
	applyLexemeListFilters(q, query)

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count lexemes: %w", err)
	}

	applyLexemeOrdering(q, query)

	if offset := query.Offset(); offset > 0 {
		q.Offset(int(offset))
	}
	if query.PageSize > 0 {
		q.Limit(int(query.PageSize))
	}

	q.WithLemmas(func(lq *entdb.LemmaQuery) {
		lq.WithForms()
	})

	rows, err := q.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list lexemes: %w", err)
	}

	out := make([]*entity.Lexeme, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntLexeme(row))
	}

	return out, int64(total), nil
}

func (r *lexemeRepository) ListByLemmaID(ctx context.Context, lemmaID int64) ([]*entity.Lexeme, error) {
	if lemmaID == 0 {
		return []*entity.Lexeme{}, nil
	}
	lemmaRow, err := r.client.Lemma.Query().
		Where(entlemma.IDEQ(lemmaID)).
		WithLexeme().
		First(ctx)
	if err != nil {
		return nil, translateDBError(err, "word")
	}
	lexemeRow, err := lemmaRow.Edges.LexemeOrErr()
	if err != nil {
		return nil, translateDBError(err, "lexeme")
	}
	rows, err := r.client.Lexeme.Query().
		Where(
			entlexeme.LanguageCodeEQ(lexemeRow.LanguageCode),
			entlexeme.HasLemmasWith(entlemma.NormalizedEQ(lemmaRow.Normalized)),
		).
		WithLemmas(func(lq *entdb.LemmaQuery) {
			lq.WithForms()
		}).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list lexemes by lemma id: %w", err)
	}
	out := make([]*entity.Lexeme, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntLexeme(row))
	}
	return out, nil
}

func (r *lexemeRepository) ListByIDs(ctx context.Context, ids []int64) ([]*entity.Lexeme, error) {
	if len(ids) == 0 {
		return []*entity.Lexeme{}, nil
	}
	rows, err := r.client.Lexeme.Query().
		Where(entlexeme.IDIn(ids...)).
		WithLemmas(func(lq *entdb.LemmaQuery) {
			lq.WithForms()
		}).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list lexemes by ids: %w", err)
	}
	out := make([]*entity.Lexeme, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntLexeme(row))
	}
	return out, nil
}

func (r *lexemeRepository) Delete(ctx context.Context, lexemeID int64) error {
	if lexemeID == 0 {
		return entity.ErrInvalidInput
	}
	return r.client.Lexeme.DeleteOneID(lexemeID).Exec(context.Background())
}

func (r *lexemeRepository) fetchAggregate(ctx context.Context, predicate entpredicate.Lexeme) (*entity.Lexeme, error) {
	rec, err := r.client.Lexeme.Query().
		Where(predicate).
		WithLemmas(func(q *entdb.LemmaQuery) {
			q.WithForms()
		}).
		First(ctx)
	if err != nil {
		return nil, err
	}
	return mapEntLexeme(rec), nil
}

func applyLexemeListFilters(q *entdb.LexemeQuery, params *repository.ListLexemeQuery) {
	if params.Language == "" {
		params.Language = entity.LanguageEnglish.CodeOrDefault()
	}
	q.Where(entlexeme.LanguageCodeEQ(params.Language))

	if params.Keyword != "" {
		q.Where(entlexeme.HasLemmasWith(entlemma.SurfaceContainsFold(params.Keyword)))
	}
	if params.EntryType != "" {
		q.Where(entlexeme.EntryTypeEQ(params.EntryType))
	}
	if len(params.ExternalIDs) > 0 {
		externalIDs := make([]string, 0, len(params.ExternalIDs))
		for _, externalID := range params.ExternalIDs {
			if trimmed := strings.TrimSpace(externalID); trimmed != "" {
				externalIDs = append(externalIDs, trimmed)
			}
		}
		if len(externalIDs) > 0 {
			q.Where(entlexeme.ExternalIDIn(externalIDs...))
		}
	}
}

func applyLexemeOrdering(q *entdb.LexemeQuery, params *repository.ListLexemeQuery) {
	for _, term := range []struct {
		key  string
		desc bool
	}{
		{params.PrimaryKey, params.PrimaryDesc},
		{params.SecondaryKey, params.SecondaryDesc},
	} {
		switch term.key {
		case "created_at":
			if term.desc {
				q.Order(entlexeme.ByCreatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlexeme.ByCreatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "updated_at":
			if term.desc {
				q.Order(entlexeme.ByUpdatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlexeme.ByUpdatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "lemma":
			if term.desc {
				q.Order(entlexeme.ByLemmas(sql.OrderByField(entlemma.FieldSurface, sql.OrderDesc())))
			} else {
				q.Order(entlexeme.ByLemmas(sql.OrderByField(entlemma.FieldSurface, sql.OrderAsc())))
			}
		case "id":
			if term.desc {
				q.Order(entlexeme.ByID(sql.OrderDesc()))
			} else {
				q.Order(entlexeme.ByID())
			}
		}
	}

	q.Order(entlexeme.ByID())
}

func mapEntLexeme(rec *entdb.Lexeme) *entity.Lexeme {
	if rec == nil {
		return nil
	}

	lex := &entity.Lexeme{
		ID:           rec.ID,
		ExternalID:   rec.ExternalID,
		Language:     entity.ParseLanguage(rec.LanguageCode),
		PartOfSpeech: rec.Pos,
		EntryType:    entity.LexemeEntryType(rec.EntryType),
		Level:        rec.Level,
		Frequencies:  append([]entity.Frequency{}, rec.Frequencies...),
		SenseGloss:   rec.SenseGloss,
		Categories:   append([]string{}, rec.Categories...),
		Completeness: rec.Completeness,
		CreatedAt:    rec.CreatedAt,
		UpdatedAt:    rec.UpdatedAt,
	}

	// Note: PrimaryLemmaID, LemmaText, and Forms have been removed from entity.Lexeme
	// Forms are now accessed through the Lemma entity

	lex.Senses = append([]entity.LexemeSense{}, rec.Senses...)

	return lex
}

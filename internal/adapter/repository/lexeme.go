package repository

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	entlexemeform "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexemeform"
	entpredicate "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/predicate"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/pkg/filterexpr"
)

type lexemeRepository struct {
	client *entdb.Client
}

// NewLexemeRepository constructs an ent-backed lexeme repository.
func NewLexemeRepository(client *entdb.Client) repository.LexemeRepository {
	return &lexemeRepository{client: client}
}

type listLexemeParams struct {
	Language      string
	Keyword       string
	EntryType     string
	ExternalIDs   []string
	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

func (r *lexemeRepository) Create(ctx context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
	if lexeme == nil || strings.TrimSpace(lexeme.ExternalID) == "" {
		return nil, entity.ErrInvalidLexemeID
	}

	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Create lexeme record (without forms - forms are in separate table now)
	main := tx.Lexeme.Create().
		SetExternalID(strings.TrimSpace(lexeme.ExternalID)).
		SetLanguage(entity.NormalizeLanguage(lexeme.Language).Code()).
		SetPos(strings.TrimSpace(lexeme.PartOfSpeech)).
		SetEntryType(string(lexeme.EntryType)).
		SetLemma(strings.TrimSpace(lexeme.Lemma)).
		SetSenses(append([]entity.LexemeSense{}, lexeme.Senses...)).
		SetRelations(append([]entity.LexemeRelation{}, lexeme.Relations...))

	if lexeme.LemmaID > 0 {
		main.SetWordID(lexeme.LemmaID)
	}

	rec, err := main.Save(ctx)
	if err != nil {
		return nil, translateDBError(err, "lexeme")
	}

	// Create form records
	if err := r.upsertForms(ctx, tx.Client(), rec.ID, lexeme.Forms); err != nil {
		return nil, fmt.Errorf("create forms: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.GetByID(ctx, rec.ID)
}

func (r *lexemeRepository) Update(ctx context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
	if lexeme == nil || lexeme.ID == 0 {
		return nil, entity.ErrInvalidLexemeID
	}

	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Update lexeme record (without forms)
	update := tx.Lexeme.UpdateOneID(lexeme.ID).
		SetLanguage(entity.NormalizeLanguage(lexeme.Language).Code()).
		SetPos(strings.TrimSpace(lexeme.PartOfSpeech)).
		SetEntryType(string(lexeme.EntryType)).
		SetLemma(strings.TrimSpace(lexeme.Lemma)).
		SetSenses(append([]entity.LexemeSense{}, lexeme.Senses...)).
		SetRelations(append([]entity.LexemeRelation{}, lexeme.Relations...))

	if lexeme.LemmaID > 0 {
		update.SetWordID(lexeme.LemmaID)
	} else {
		update.ClearWordID()
	}

	if _, err := update.Save(ctx); err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrLexemeNotFound
		}
		return nil, translateDBError(err, "lexeme")
	}

	// Update form records
	if err := r.upsertForms(ctx, tx.Client(), lexeme.ID, lexeme.Forms); err != nil {
		return nil, fmt.Errorf("update forms: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.GetByID(ctx, lexeme.ID)
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
	formText := strings.ToLower(word)
	langCode := entity.NormalizeLanguage(language).Code()

	// Use Edge to query lexeme by form text
	rec, err := r.client.Lexeme.Query().
		Where(
			entlexeme.LanguageEQ(langCode),
			entlexeme.HasFormsWith(
				entlexemeform.TextEQ(formText),
			),
		).
		WithForms(). // Preload forms to avoid N+1
		First(ctx)
	if err != nil {
		return nil, translateDBError(err, "lexeme")
	}
	return mapEntLexeme(rec), nil
}

func (r *lexemeRepository) BatchLookupFormInfo(ctx context.Context, surfaceForms []string, language entity.Language) (map[string][]*repository.LexemeFormInfo, error) {
	if len(surfaceForms) == 0 {
		return make(map[string][]*repository.LexemeFormInfo), nil
	}

	langCode := entity.NormalizeLanguage(language).Code()

	// Normalize all forms to lowercase
	formTexts := make([]string, 0, len(surfaceForms))
	originalToLower := make(map[string]string)
	for _, sf := range surfaceForms {
		word := strings.TrimSpace(sf)
		if word == "" {
			continue
		}
		formText := strings.ToLower(word)
		formTexts = append(formTexts, formText)
		originalToLower[word] = formText
	}

	if len(formTexts) == 0 {
		return make(map[string][]*repository.LexemeFormInfo), nil
	}

	// Batch query lexeme_forms with lexeme join
	forms, err := r.client.LexemeForm.Query().
		Where(entlexemeform.TextIn(formTexts...)).
		WithLexeme(func(q *entdb.LexemeQuery) {
			q.Where(entlexeme.LanguageEQ(langCode))
		}).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("batch lookup form info: %w", err)
	}

	// Build result map - now collecting ALL forms per surface term
	result := make(map[string][]*repository.LexemeFormInfo)
	for _, form := range forms {
		lexeme, err := form.Edges.LexemeOrErr()
		if err != nil {
			continue
		}

		info := &repository.LexemeFormInfo{
			FormText:    form.Text,
			FormType:    form.FormType,
			IsIrregular: form.IsIrregular,
			LemmaText:   lexeme.Lemma,
			Pos:         lexeme.Pos,
		}

		// Map back to original case - append all forms instead of overwriting
		for original, lower := range originalToLower {
			if lower == form.Text {
				result[original] = append(result[original], info)
			}
		}
	}

	return result, nil
}

func (r *lexemeRepository) List(ctx context.Context, query *repository.ListLexemeQuery) ([]*entity.Lexeme, int64, error) {
	var params listLexemeParams
	if err := filterexpr.Bind(query, &params, listLexemesSchema); err != nil {
		return nil, 0, err
	}

	q := r.client.Lexeme.Query()
	applyLexemeListFilters(q, params)

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count lexemes: %w", err)
	}

	applyLexemeOrdering(q, params)

	if offset := query.Offset(); offset > 0 {
		q.Offset(int(offset))
	}
	if query.PageSize > 0 {
		q.Limit(int(query.PageSize))
	}

	// Preload forms to avoid N+1
	q.WithForms()

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
	rows, err := r.client.Lexeme.Query().
		Where(entlexeme.WordIDEQ(lemmaID)).
		WithForms().
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
		WithForms().
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
		return entity.ErrInvalidLexemeID
	}

	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Delete lexeme (LexemeForm will be cascade deleted automatically)
	if err := tx.Lexeme.DeleteOneID(lexemeID).Exec(ctx); err != nil {
		if entdb.IsNotFound(err) {
			return entity.ErrLexemeNotFound
		}
		return fmt.Errorf("delete lexeme: %w", err)
	}

	return tx.Commit()
}

func (r *lexemeRepository) fetchAggregate(ctx context.Context, predicate entpredicate.Lexeme) (*entity.Lexeme, error) {
	rec, err := r.client.Lexeme.Query().
		Where(predicate).
		WithForms(). // Preload forms
		First(ctx)
	if err != nil {
		return nil, err
	}
	return mapEntLexeme(rec), nil
}

func applyLexemeListFilters(q *entdb.LexemeQuery, params listLexemeParams) {
	if params.Language == "" {
		params.Language = entity.LanguageEnglish.CodeOrDefault()
	}
	q.Where(entlexeme.LanguageEQ(params.Language))

	if params.Keyword != "" {
		q.Where(entlexeme.LemmaContainsFold(params.Keyword))
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

func applyLexemeOrdering(q *entdb.LexemeQuery, params listLexemeParams) {
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
				q.Order(entlexeme.ByLemma(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entlexeme.ByLemma(sql.OrderAsc(), sql.OrderNullsLast()))
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
		Language:     entity.ParseLanguage(rec.Language),
		PartOfSpeech: rec.Pos,
		EntryType:    entity.LexemeEntryType(rec.EntryType),
		Lemma:        rec.Lemma,
		CreatedAt:    rec.CreatedAt,
		UpdatedAt:    rec.UpdatedAt,
	}

	if rec.WordID != nil {
		lex.LemmaID = *rec.WordID
	}

	// Map forms from edge
	if rec.Edges.Forms != nil {
		lex.Forms = make([]entity.LexemeForm, 0, len(rec.Edges.Forms))
		for _, f := range rec.Edges.Forms {
			lex.Forms = append(lex.Forms, entity.LexemeForm{
				ID:          f.ID,
				LexemeID:    f.LexemeID,
				Text:        f.Text,
				FormType:    entity.LexemeFormType(f.FormType),
				IsIrregular: f.IsIrregular,
				Phonetics:   append([]entity.Phonetic{}, f.Phonetics...),
				CreatedAt:   f.CreatedAt,
				UpdatedAt:   f.UpdatedAt,
			})
		}
	}

	lex.Senses = append([]entity.LexemeSense{}, rec.Senses...)
	lex.Relations = append([]entity.LexemeRelation{}, rec.Relations...)

	return lex
}

// upsertForms replaces all forms for a lexeme with the given list
func (r *lexemeRepository) upsertForms(ctx context.Context, client *entdb.Client, lexemeID int64, forms []entity.LexemeForm) error {
	// Delete existing forms
	if _, err := client.LexemeForm.Delete().
		Where(entlexemeform.LexemeIDEQ(lexemeID)).
		Exec(ctx); err != nil {
		return fmt.Errorf("delete old forms: %w", err)
	}

	// Create new forms
	if len(forms) == 0 {
		return nil
	}

	bulk := make([]*entdb.LexemeFormCreate, 0, len(forms))
	for _, f := range forms {
		bulk = append(bulk, client.LexemeForm.Create().
			SetLexemeID(lexemeID).
			SetText(strings.ToLower(strings.TrimSpace(f.Text))).
			SetFormType(string(f.FormType)).
			SetIsIrregular(f.IsIrregular).
			SetPhonetics(append([]entity.Phonetic{}, f.Phonetics...)))
	}

	if err := client.LexemeForm.CreateBulk(bulk...).Exec(ctx); err != nil {
		return fmt.Errorf("bulk create forms: %w", err)
	}

	return nil
}

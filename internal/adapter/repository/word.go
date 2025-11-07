package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entword "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/word"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/pkg/filterexpr"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/samber/lo"
)

type wordRepository struct {
	client *entdb.Client
}

// NewWordRepository constructs an ent-backed word repository.
func NewWordRepository(client *entdb.Client) repository.WordRepository {
	return &wordRepository{client: client}
}

type listWordsParams struct {
	Language      string
	Keyword       string
	WordType      string
	Words         []string
	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

func (r *wordRepository) Create(ctx context.Context, word *entity.Word) (*entity.Word, error) {
	builder := r.client.Word.Create().
		SetText(word.Text).
		SetNormalized(entity.NormalizeWordToken(word.Text)).
		SetLanguage(entity.NormalizeLanguage(word.Language).Code()).
		SetWordType(defaultWordType(word.WordType)).
		SetNillableLemma(normalizeLemma(word.Lemma)).
		SetPhonetics(word.Phonetics).
		SetDefinitions(word.Definitions).
		SetPhrases(word.Phrases).
		SetSentences(word.Sentences).
		SetRelations(word.Relations).
		SetCategories(word.Categories).
		SetCompleteness(word.Completeness).
		SetIsStandardRule(word.IsStandardRule).
		SetIsManualEdited(word.IsManualEdited)

	rec, err := builder.Save(ctx)
	if err != nil {
		return nil, translateWordError(err)
	}

	return mapEntWord(rec), nil
}

func (r *wordRepository) Update(ctx context.Context, word *entity.Word) (*entity.Word, error) {
	mutation := r.client.Word.UpdateOneID(int(word.ID)).
		SetText(word.Text).
		SetNormalized(entity.NormalizeWordToken(word.Text)).
		SetLanguage(entity.NormalizeLanguage(word.Language).Code()).
		SetWordType(defaultWordType(word.WordType)).
		SetPhonetics(word.Phonetics).
		SetDefinitions(word.Definitions).
		SetPhrases(word.Phrases).
		SetSentences(word.Sentences).
		SetRelations(word.Relations).
		SetCategories(word.Categories).
		SetCompleteness(word.Completeness).
		SetIsStandardRule(word.IsStandardRule).
		SetIsManualEdited(word.IsManualEdited)

	if lemma := normalizeLemma(word.Lemma); lemma != nil {
		mutation.SetLemma(*lemma)
	} else {
		mutation.ClearLemma()
	}

	rec, err := mutation.Save(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrVocNotFound
		}
		return nil, translateWordError(err)
	}

	return mapEntWord(rec), nil
}

func (r *wordRepository) GetByID(ctx context.Context, id int64) (*entity.Word, error) {
	rec, err := r.client.Word.Get(ctx, int(id))
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrVocNotFound
		}
		return nil, fmt.Errorf("get word: %w", err)
	}

	return mapEntWord(rec), nil
}

func (r *wordRepository) Lookup(ctx context.Context, text string, language entity.Language) (*entity.Word, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	normalizedLang := entity.NormalizeLanguage(language).Code()
	rec, err := r.client.Word.Query().
		Where(
			entword.TextEQ(text),
			entword.LanguageEQ(normalizedLang),
		).
		Order(func(s *sql.Selector) {
			s.OrderExpr(sql.ExprFunc(func(b *sql.Builder) {
				b.WriteString("CASE WHEN ")
				b.WriteString(s.C(entword.FieldWordType))
				b.WriteString(" = ")
				b.Arg(entity.WordTypeLemma)
				b.WriteString(" THEN 0 ELSE 1 END")
			}))
			s.OrderBy(s.C(entword.FieldID))
		}).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup word: %w", err)
	}

	return mapEntWord(rec), nil
}

func (r *wordRepository) List(ctx context.Context, query *repository.ListWordQuery) ([]*entity.Word, int64, error) {
	var params listWordsParams
	if err := filterexpr.Bind(query, &params, listWordsSchema); err != nil {
		return nil, 0, err
	}

	wordsQuery := r.client.Word.Query()
	applyListFilters(wordsQuery, params)

	total, err := wordsQuery.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count words: %w", err)
	}

	applyListOrdering(wordsQuery, params)

	offset := query.Offset()
	if offset > 0 {
		wordsQuery.Offset(int(offset))
	}
	if query.PageSize > 0 {
		wordsQuery.Limit(int(query.PageSize))
	}

	rows, err := wordsQuery.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list words: %w", err)
	}

	results := make([]*entity.Word, 0, len(rows))
	for _, row := range rows {
		results = append(results, mapEntWord(row))
	}

	return results, int64(total), nil
}

func (r *wordRepository) Delete(ctx context.Context, id int64) error {
	err := r.client.Word.DeleteOneID(int(id)).Exec(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return entity.ErrVocNotFound
		}
		return fmt.Errorf("delete word: %w", err)
	}
	return nil
}

// ListFormsByLemma returns all non-lemma forms (text + voc_type) for a lemma.
func (r *wordRepository) ListFormsByLemma(ctx context.Context, lemma string, language entity.Language) ([]entity.WordFormRef, error) {
	if strings.TrimSpace(lemma) == "" {
		return []entity.WordFormRef{}, nil
	}

	rows, err := r.client.Word.Query().
		Where(
			entword.LanguageEQ(entity.NormalizeLanguage(language).Code()),
			entword.LemmaEQ(lemma),
		).
		Order(entword.ByText()).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list forms: %w", err)
	}

	forms := make([]entity.WordFormRef, 0, len(rows))
	for _, row := range rows {
		if row.WordType == entity.WordTypeLemma {
			continue
		}
		forms = append(forms, entity.WordFormRef{
			Text:     row.Text,
			WordType: row.WordType,
		})
	}
	return forms, nil
}

func applyListFilters(q *entdb.WordQuery, params listWordsParams) {
	if params.Language == "" {
		params.Language = entity.LanguageEnglish.CodeOrDefault()
	}
	q.Where(entword.LanguageEQ(params.Language))
	if params.Keyword != "" {
		q.Where(entword.TextContainsFold(params.Keyword))
	}
	if params.WordType != "" {
		q.Where(entword.WordTypeEQ(params.WordType))
	}
	if words := uniqueFolded(params.Words); len(words) > 0 {
		q.Where(entword.NormalizedIn(lo.Map(words, func(word string, _ int) string { return strings.ToLower(word) })...))
	}
}

func applyListOrdering(q *entdb.WordQuery, params listWordsParams) {
	if params.Keyword != "" {
		q.Order(func(s *sql.Selector) {
			s.OrderExpr(sql.ExprFunc(func(b *sql.Builder) {
				b.WriteString("CASE WHEN ")
				b.WriteString(s.C(entword.FieldText))
				b.WriteString(" = ")
				b.Arg(params.Keyword)
				b.WriteString(" THEN 0 ELSE 1 END")
			}))
		})
	}

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
				q.Order(entword.ByCreatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entword.ByCreatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "updated_at":
			if term.desc {
				q.Order(entword.ByUpdatedAt(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entword.ByUpdatedAt(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "text":
			if term.desc {
				q.Order(entword.ByText(sql.OrderDesc(), sql.OrderNullsLast()))
			} else {
				q.Order(entword.ByText(sql.OrderAsc(), sql.OrderNullsLast()))
			}
		case "id":
			if term.desc {
				q.Order(entword.ByID(sql.OrderDesc()))
			} else {
				q.Order(entword.ByID())
			}
		}
	}

	q.Order(entword.ByID())
}

func mapEntWord(rec *entdb.Word) *entity.Word {
	if rec == nil {
		return nil
	}
	word := &entity.Word{
		ID:             int64(rec.ID),
		Text:           rec.Text,
		Language:       entity.ParseLanguage(rec.Language),
		WordType:       rec.WordType,
		Phonetics:      rec.Phonetics,
		Definitions:    rec.Definitions,
		Categories:     rec.Categories,
		Phrases:        rec.Phrases,
		Sentences:      rec.Sentences,
		Relations:      rec.Relations,
		Completeness:   rec.Completeness,
		IsStandardRule: rec.IsStandardRule,
		IsManualEdited: rec.IsManualEdited,
		CreatedAt:      rec.CreatedAt,
		UpdatedAt:      rec.UpdatedAt,
	}
	if rec.Lemma != nil {
		lemma := *rec.Lemma
		word.Lemma = &lemma
	}
	return word
}

func normalizeLemma(lemma *string) *string {
	if lemma == nil {
		return nil
	}
	val := strings.TrimSpace(*lemma)
	if val == "" {
		return nil
	}
	return &val
}

func defaultWordType(vt string) string {
	if vt == "" {
		return entity.WordTypeLemma
	}
	return vt
}

func translateWordError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return entity.ErrDuplicateWord
		case "23503":
			return entity.ErrVocNotFound
		}
	}
	if entdb.IsNotFound(err) {
		return entity.ErrVocNotFound
	}
	return err
}

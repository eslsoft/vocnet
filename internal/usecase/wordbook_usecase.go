package usecase

import (
	"context"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/auth"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/pkg/safeconv"
	"github.com/google/uuid"
)

//go:generate mockgen -source=wordbook_usecase.go -destination=../mocks/mock_wordbook_usecase.go -package=mocks

// WordbookUsecase orchestrates wordbook workflows.
type WordbookUsecase interface {
	SyncBuiltin(ctx context.Context, books []*entity.Wordbook) error
	List(ctx context.Context, query *repository.ListWordbookQuery) ([]*entity.Wordbook, int64, error)
	Get(ctx context.Context, id int64) (*entity.Wordbook, error)
	Create(ctx context.Context, book *entity.Wordbook) (*entity.Wordbook, error)
	Update(ctx context.Context, book *entity.Wordbook) (*entity.Wordbook, error)
	Delete(ctx context.Context, id int64) error
	AddWords(ctx context.Context, id int64, terms []string) (*entity.Wordbook, error)
	RemoveWords(ctx context.Context, id int64, terms []string) (*entity.Wordbook, error)
}

type wordbookUsecase struct {
	repo    repository.WordbookRepository
	learned repository.LearnedWordRepository
}

func NewWordbookUsecase(repo repository.WordbookRepository, learned repository.LearnedWordRepository) WordbookUsecase {
	return &wordbookUsecase{repo: repo, learned: learned}
}

func (u *wordbookUsecase) SyncBuiltin(ctx context.Context, books []*entity.Wordbook) error {
	for _, b := range books {
		if b == nil {
			continue
		}
		b.UserID = uuid.Nil
		b.Source = entity.WordbookSourceBuiltin
		if b.Visibility == entity.WordbookVisibilityUnspecified {
			b.Visibility = entity.WordbookVisibilityPublic
		}
		if b.SortOrder == 0 {
			b.SortOrder = 100
		}
		normalized, err := entity.NormalizeWordbook(b)
		if err != nil {
			return err
		}
		*b = *normalized
	}
	return u.repo.SyncBuiltin(ctx, books)
}

func (u *wordbookUsecase) List(ctx context.Context, query *repository.ListWordbookQuery) ([]*entity.Wordbook, int64, error) {
	userID := auth.GetUserIDOrZero(ctx)

	if query == nil {
		query = &repository.ListWordbookQuery{}
	}
	query.UserID = userID
	if !query.IncludeBuiltin {
		query.IncludeBuiltin = true
	}

	items, total, err := u.repo.List(ctx, query)
	if err != nil {
		return nil, 0, err
	}
	for _, wb := range items {
		u.attachStats(ctx, userID, wb)
	}
	return items, total, nil
}

func (u *wordbookUsecase) Get(ctx context.Context, id int64) (*entity.Wordbook, error) {
	userID := auth.GetUserIDOrZero(ctx)

	if id <= 0 {
		return nil, entity.ErrInvalidWordbookID
	}
	book, err := u.repo.GetByID(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	u.attachStats(ctx, userID, book)
	return book, nil
}

func (u *wordbookUsecase) Create(ctx context.Context, book *entity.Wordbook) (*entity.Wordbook, error) {
	userID := auth.MustGetUserID(ctx)

	book.UserID = userID
	book.Source = entity.WordbookSourceUser
	now := time.Now()
	book.CreatedAt = now
	book.UpdatedAt = now
	normalized, err := entity.NormalizeWordbook(book)
	if err != nil {
		return nil, err
	}
	return u.repo.Create(ctx, normalized)
}

func (u *wordbookUsecase) Update(ctx context.Context, book *entity.Wordbook) (*entity.Wordbook, error) {
	userID := auth.MustGetUserID(ctx)

	if book == nil || book.ID <= 0 {
		return nil, entity.ErrInvalidWordbookID
	}

	current, err := u.repo.GetByID(ctx, book.ID, userID)
	if err != nil {
		return nil, err
	}
	if current.Source == entity.WordbookSourceBuiltin {
		return nil, entity.ErrBuiltinWordbookLocked
	}
	book.UserID = userID
	book.Source = current.Source
	if book.Language == entity.LanguageUnspecified {
		book.Language = current.Language
	}
	if book.Visibility == entity.WordbookVisibilityUnspecified {
		book.Visibility = current.Visibility
	}
	if strings.TrimSpace(book.Name) == "" {
		book.Name = current.Name
	}
	if book.Description == "" {
		book.Description = current.Description
	}
	book.CreatedAt = current.CreatedAt
	book.UpdatedAt = time.Now()

	normalized, err := entity.NormalizeWordbook(book)
	if err != nil {
		return nil, err
	}
	return u.repo.Update(ctx, normalized)
}

func (u *wordbookUsecase) Delete(ctx context.Context, id int64) error {
	userID := auth.MustGetUserID(ctx)

	if id <= 0 {
		return entity.ErrInvalidWordbookID
	}
	book, err := u.repo.GetByID(ctx, id, userID)
	if err != nil {
		return err
	}
	if book.Source == entity.WordbookSourceBuiltin {
		return entity.ErrBuiltinWordbookLocked
	}
	return u.repo.Delete(ctx, id, userID)
}

func (u *wordbookUsecase) AddWords(ctx context.Context, id int64, terms []string) (*entity.Wordbook, error) {
	if len(terms) == 0 {
		return nil, entity.ErrInvalidInput
	}
	book, err := u.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if book.Source == entity.WordbookSourceBuiltin || book.UserID == uuid.Nil {
		return nil, entity.ErrBuiltinWordbookLocked
	}
	book.Terms = append(book.Terms, terms...)
	book.UpdatedAt = time.Now()
	norm, err := entity.NormalizeWordbook(book)
	if err != nil {
		return nil, err
	}
	return u.repo.Update(ctx, norm)
}

func (u *wordbookUsecase) RemoveWords(ctx context.Context, id int64, terms []string) (*entity.Wordbook, error) {
	if len(terms) == 0 {
		return nil, entity.ErrInvalidInput
	}
	book, err := u.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if book.Source == entity.WordbookSourceBuiltin || book.UserID == uuid.Nil {
		return nil, entity.ErrBuiltinWordbookLocked
	}

	lookup := make(map[string]struct{}, len(terms))
	for _, term := range terms {
		lookup[strings.TrimSpace(term)] = struct{}{}
	}
	filtered := make([]string, 0, len(book.Terms))
	for _, term := range book.Terms {
		if _, remove := lookup[term]; remove {
			continue
		}
		filtered = append(filtered, term)
	}
	book.Terms = filtered
	book.UpdatedAt = time.Now()

	norm, err := entity.NormalizeWordbook(book)
	if err != nil {
		return nil, err
	}
	return u.repo.Update(ctx, norm)
}

func (u *wordbookUsecase) attachStats(ctx context.Context, userID uuid.UUID, book *entity.Wordbook) {
	if book == nil {
		return
	}
	book.Stats.TotalWords = safeconv.IntToInt32(len(book.Terms))
	if userID == uuid.Nil || u.learned == nil || len(book.Terms) == 0 {
		return
	}
	stats, err := u.learned.StatsByTerms(ctx, userID, book.Terms)
	if err != nil {
		return // best-effort; keep default totals
	}
	book.Stats = stats
}

package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

type ListWordbookQuery struct {
	Pagination

	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool

	UserID         int64
	NameQuery      string
	Language       string
	Visibility     string
	IncludeBuiltin bool
}

// WordbookRepository defines data access for wordbooks.
type WordbookRepository interface {
	Create(ctx context.Context, book *entity.Wordbook) (*entity.Wordbook, error)
	Update(ctx context.Context, book *entity.Wordbook) (*entity.Wordbook, error)
	Delete(ctx context.Context, id int64, userID int64) error
	GetByID(ctx context.Context, id int64, userID int64) (*entity.Wordbook, error)
	List(ctx context.Context, query *ListWordbookQuery) ([]*entity.Wordbook, int64, error)
	SyncBuiltin(ctx context.Context, books []*entity.Wordbook) error
}

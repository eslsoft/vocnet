package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

type ListLexemeQuery struct {
	Pagination

	Language      string
	Keyword       string
	EntryType     string
	ExternalIDs   []string
	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

//go:generate mockgen -source=lexeme.go -destination=../mocks/mock_lexeme_repository.go -package=mocks

// LemmaFormInfo contains basic information about a lexeme form for determining storage strategy
type LemmaFormInfo struct {
	LexemeID    int64
	FormText    string // The form text (e.g., "apples", "went")
	FormType    string // The form type (e.g., "LEMMA", "PLURAL", "PAST")
	IsIrregular bool   // Whether this is an irregular form
	LemmaText   string // The lemma text (e.g., "apple", "go")
	Pos         string // The part of speech (e.g., "verb", "noun", "proper-noun")
}

// LexemeRepository defines data access for lexeme entries.
type LexemeRepository interface {
	Create(ctx context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error)
	Update(ctx context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error)
	GetByID(ctx context.Context, lexemeID int64) (*entity.Lexeme, error)
	GetByExternalID(ctx context.Context, externalID string) (*entity.Lexeme, error)
	Lookup(ctx context.Context, surfaceForm string, language entity.Language) (*entity.Lexeme, error)
	// BatchLookupFormInfo returns all possible form infos for each surface term.
	// A surface term can map to multiple lexemes (e.g., "learning" can be both a verb form and a noun).
	BatchLookupFormInfo(ctx context.Context, surfaceForms []string, language entity.Language) (map[string][]*LemmaFormInfo, error)
	List(ctx context.Context, filter *ListLexemeQuery) ([]*entity.Lexeme, int64, error)
	ListByLemmaID(ctx context.Context, lemmaID int64) ([]*entity.Lexeme, error)
	ListByIDs(ctx context.Context, ids []int64) ([]*entity.Lexeme, error)
	// BatchGetByExternalIDs returns lexemes for multiple external IDs in a single query.
	// Returns a map from ExternalID to Lexeme. Missing IDs are not included.
	BatchGetByExternalIDs(ctx context.Context, externalIDs []string) (map[string]*entity.Lexeme, error)
	Delete(ctx context.Context, lexemeID int64) error
	DeleteByLemmaID(ctx context.Context, lemmaID int64) error
}

package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

//go:generate mockgen -source=lemma.go -destination=../mocks/mock_lemma_repository.go -package=mocks

type LemmaRepository interface {
	// Query operations (read-only)
	GetByID(ctx context.Context, lemmaID int64) (*entity.Lemma, error)
	LookupByForm(ctx context.Context, surface string, language entity.Language) (*entity.Lemma, error)
	ListByFormNormalized(ctx context.Context, surface string, language entity.Language) ([]*entity.Lemma, error)
	List(ctx context.Context, query *ListWordsQuery) ([]*entity.Lemma, int64, error)
	ListCategories(ctx context.Context, search string) ([]string, error)
	Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error)

	// ResolveLemmaSurfacesByLexemeExternalIDs resolves external lexeme IDs (e.g. "L123456")
	// to a displayable lemma surface. Used for returning relations without exposing IDs.
	ResolveLemmaSurfacesByLexemeExternalIDs(ctx context.Context, externalIDs []string, language entity.Language) (map[string]string, error)

	// CreateMinimal creates a minimal lemma+form (used by pipeline)
	// Returns the created lemma without any lexemes yet
	CreateMinimal(ctx context.Context, surface string, language entity.Language) (*entity.Lemma, error)

	// Update updates an existing lemma
	Update(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error)

	// CreateForms creates additional word forms (past, plural, etc.) for a lemma
	CreateForms(ctx context.Context, lemmaID int64, forms []entity.LemmaForm) error

	// UpdateFormPhonetics updates phonetics for a specific form type of a lemma
	UpdateFormPhonetics(ctx context.Context, lemmaID int64, formType entity.FormType, phonetics []entity.Phonetic) error

	// UpdateFormSyllables updates syllables for a specific form type of a lemma
	UpdateFormSyllables(ctx context.Context, lemmaID int64, formType entity.FormType, syllables []string) error

	// UpdateFormIrregular updates the is_irregular flag for a specific form of a lemma
	UpdateFormIrregular(ctx context.Context, lemmaID int64, surface string, formType entity.FormType, isIrregular bool) error

	// DeleteFormsByKeys deletes lemma_form rows matching each (surface, formType) pair for a given lemma.
	// surfaces and formTypes are parallel slices of equal length.
	DeleteFormsByKeys(ctx context.Context, lemmaID int64, surfaces []string, formTypes []entity.FormType) error
}

package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// SemanticRelationRepository manages semantic relations between lexemes.
type SemanticRelationRepository interface {
	BatchCreate(ctx context.Context, relations []*entity.SemanticRelation) ([]*entity.SemanticRelation, error)
	FindBySourceLexeme(ctx context.Context, sourceLexemeID int64) ([]*entity.SemanticRelation, error)
	FindByTargetLexeme(ctx context.Context, targetLexemeID int64) ([]*entity.SemanticRelation, error)
	DeleteByLemmaID(ctx context.Context, lemmaID int64) error
}

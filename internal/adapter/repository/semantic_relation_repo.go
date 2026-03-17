package repository

import (
	"context"
	"fmt"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	entsemrel "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/semanticrelation"
	"github.com/eslsoft/vocnet/internal/repository"
)

type semanticRelationRepository struct {
	client *entdb.Client
}

func NewSemanticRelationRepository(client *entdb.Client) repository.SemanticRelationRepository {
	return &semanticRelationRepository{client: client}
}

func (r *semanticRelationRepository) BatchCreate(ctx context.Context, relations []*entity.SemanticRelation) ([]*entity.SemanticRelation, error) {
	if len(relations) == 0 {
		return nil, nil
	}

	builders := make([]*entdb.SemanticRelationCreate, 0, len(relations))
	for _, rel := range relations {
		b := r.client.SemanticRelation.Create().
			SetSourceLexemeID(rel.SourceLexemeID).
			SetTargetRef(rel.TargetRef).
			SetTargetTerm(rel.TargetTerm).
			SetRelationType(rel.RelationType).
			SetProvider(rel.Provider).
			SetStrength(rel.Strength).
			SetSenseMapped(rel.SenseMapped)

		if rel.TargetLexemeID != nil {
			b.SetTargetLexemeID(*rel.TargetLexemeID)
		}
		builders = append(builders, b)
	}

	rows, err := r.client.SemanticRelation.CreateBulk(builders...).Save(ctx)
	if err != nil {
		return nil, translateDBError(err, "semantic_relation")
	}

	out := make([]*entity.SemanticRelation, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntSemanticRelation(row))
	}
	return out, nil
}

func (r *semanticRelationRepository) FindBySourceLexeme(ctx context.Context, sourceLexemeID int64) ([]*entity.SemanticRelation, error) {
	rows, err := r.client.SemanticRelation.Query().
		Where(entsemrel.SourceLexemeIDEQ(sourceLexemeID)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("find relations by source: %w", err)
	}
	out := make([]*entity.SemanticRelation, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntSemanticRelation(row))
	}
	return out, nil
}

func (r *semanticRelationRepository) FindByTargetLexeme(ctx context.Context, targetLexemeID int64) ([]*entity.SemanticRelation, error) {
	rows, err := r.client.SemanticRelation.Query().
		Where(entsemrel.TargetLexemeIDEQ(targetLexemeID)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("find relations by target: %w", err)
	}
	out := make([]*entity.SemanticRelation, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntSemanticRelation(row))
	}
	return out, nil
}

func (r *semanticRelationRepository) DeleteByLemmaID(ctx context.Context, lemmaID int64) error {
	// Find lexeme IDs for this lemma, then delete their relations.
	lexemeIDs, err := r.client.Lexeme.Query().
		Where(entlexeme.LemmaIDEQ(lemmaID)).
		IDs(ctx)
	if err != nil || len(lexemeIDs) == 0 {
		return err
	}
	_, err = r.client.SemanticRelation.Delete().
		Where(entsemrel.SourceLexemeIDIn(lexemeIDs...)).
		Exec(ctx)
	return err
}

func mapEntSemanticRelation(row *entdb.SemanticRelation) *entity.SemanticRelation {
	if row == nil {
		return nil
	}
	return &entity.SemanticRelation{
		ID:             row.ID,
		SourceLexemeID: row.SourceLexemeID,
		TargetLexemeID: row.TargetLexemeID,
		TargetRef:      row.TargetRef,
		TargetTerm:     row.TargetTerm,
		RelationType:   row.RelationType,
		Provider:       row.Provider,
		Strength:       row.Strength,
		SenseMapped:    row.SenseMapped,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
}

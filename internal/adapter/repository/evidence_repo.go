package repository

import (
	"context"
	"fmt"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entrawevidence "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/rawevidence"
	"github.com/eslsoft/vocnet/internal/repository"
)

type evidenceRepository struct {
	client *entdb.Client
}

func NewEvidenceRepository(client *entdb.Client) repository.EvidenceRepository {
	return &evidenceRepository{client: client}
}

func (r *evidenceRepository) Create(ctx context.Context, evidence *entity.RawEvidence) (*entity.RawEvidence, error) {
	if evidence == nil {
		return nil, entity.ErrInvalidInput
	}
	row, err := r.client.RawEvidence.Create().
		SetLemmaID(evidence.LemmaID).
		SetProvider(evidence.Provider).
		SetPhase(evidence.Phase).
		SetContent(evidence.Content).
		SetSchemaVersion(evidence.SchemaVersion).
		SetFetchedAt(evidence.FetchedAt).
		Save(ctx)
	if err != nil {
		return nil, translateDBError(err, "raw_evidence")
	}
	return mapEntEvidence(row), nil
}

func (r *evidenceRepository) FindByLemma(ctx context.Context, lemmaID int64) ([]*entity.RawEvidence, error) {
	rows, err := r.client.RawEvidence.Query().
		Where(entrawevidence.LemmaIDEQ(lemmaID)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("find evidence by lemma: %w", err)
	}
	return mapEntEvidences(rows), nil
}

func (r *evidenceRepository) FindByLemmaAndPhase(ctx context.Context, lemmaID int64, phase string) ([]*entity.RawEvidence, error) {
	rows, err := r.client.RawEvidence.Query().
		Where(
			entrawevidence.LemmaIDEQ(lemmaID),
			entrawevidence.PhaseEQ(phase),
		).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("find evidence by lemma and phase: %w", err)
	}
	return mapEntEvidences(rows), nil
}

func mapEntEvidence(row *entdb.RawEvidence) *entity.RawEvidence {
	if row == nil {
		return nil
	}
	return &entity.RawEvidence{
		ID:            row.ID,
		LemmaID:       row.LemmaID,
		Provider:      row.Provider,
		Phase:         row.Phase,
		Content:       row.Content,
		SchemaVersion: row.SchemaVersion,
		FetchedAt:     row.FetchedAt,
		CreatedAt:     row.CreatedAt,
	}
}

func mapEntEvidences(rows []*entdb.RawEvidence) []*entity.RawEvidence {
	out := make([]*entity.RawEvidence, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntEvidence(row))
	}
	return out
}

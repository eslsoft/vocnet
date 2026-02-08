package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entwordsnapshot "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/wordsnapshot"
	"github.com/eslsoft/vocnet/internal/repository"
)

type wordSnapshotRepository struct {
	client *entdb.Client
}

func NewWordSnapshotRepository(client *entdb.Client) repository.WordSnapshotRepository {
	return &wordSnapshotRepository{client: client}
}

func (r *wordSnapshotRepository) CreateOrUpdate(ctx context.Context, snapshot *entity.WordSnapshot) (*entity.WordSnapshot, error) {
	if snapshot == nil {
		return nil, entity.ErrInvalidInput
	}

	id, err := r.client.WordSnapshot.Create().
		SetLemmaID(snapshot.LemmaID).
		SetTerm(snapshot.Term).
		SetLanguage(snapshot.Language).
		SetVersion(snapshot.Version).
		SetData(snapshot.Data).
		SetQscore(snapshot.QScore).
		SetQscoreCompleteness(snapshot.QScoreCompleteness).
		SetQscoreDepth(snapshot.QScoreDepth).
		SetQscoreDensity(snapshot.QScoreDensity).
		SetQscoreValidity(snapshot.QScoreValidity).
		SetSynthesizedAt(snapshot.SynthesizedAt).
		OnConflictColumns("lemma_id").
		UpdateNewValues().
		ID(ctx)
	if err != nil {
		return nil, translateDBError(err, "word_snapshot")
	}

	return r.getByID(ctx, id)
}

func (r *wordSnapshotRepository) GetByLemma(ctx context.Context, lemmaID int64) (*entity.WordSnapshot, error) {
	row, err := r.client.WordSnapshot.Query().
		Where(entwordsnapshot.LemmaIDEQ(lemmaID)).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, fmt.Errorf("get snapshot by lemma: %w", err)
	}
	return mapEntWordSnapshot(row), nil
}

func (r *wordSnapshotRepository) GetByTerm(ctx context.Context, term string, language string) (*entity.WordSnapshot, error) {
	row, err := r.client.WordSnapshot.Query().
		Where(
			entwordsnapshot.TermEQ(strings.ToLower(term)),
			entwordsnapshot.LanguageEQ(language),
		).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, fmt.Errorf("get snapshot by term: %w", err)
	}
	return mapEntWordSnapshot(row), nil
}

func (r *wordSnapshotRepository) getByID(ctx context.Context, id int64) (*entity.WordSnapshot, error) {
	row, err := r.client.WordSnapshot.Get(ctx, id)
	if err != nil {
		return nil, translateDBError(err, "word_snapshot")
	}
	return mapEntWordSnapshot(row), nil
}

func mapEntWordSnapshot(row *entdb.WordSnapshot) *entity.WordSnapshot {
	if row == nil {
		return nil
	}
	return &entity.WordSnapshot{
		ID:                 row.ID,
		LemmaID:            row.LemmaID,
		Term:               row.Term,
		Language:           row.Language,
		Version:            row.Version,
		Data:               row.Data,
		QScore:             row.Qscore,
		QScoreCompleteness: row.QscoreCompleteness,
		QScoreDepth:        row.QscoreDepth,
		QScoreDensity:      row.QscoreDensity,
		QScoreValidity:     row.QscoreValidity,
		SynthesizedAt:      row.SynthesizedAt,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
	}
}

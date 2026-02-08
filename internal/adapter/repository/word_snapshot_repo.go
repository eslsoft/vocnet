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
		SetWikidataQid(snapshot.WikidataQID).
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

func (r *wordSnapshotRepository) List(ctx context.Context, query *repository.ListSnapshotsQuery) ([]*entity.WordSnapshot, int, error) {
	q := r.client.WordSnapshot.Query()

	if query.Language != "" {
		q = q.Where(entwordsnapshot.LanguageEQ(query.Language))
	}
	if query.MinQScore > 0 {
		q = q.Where(entwordsnapshot.QscoreGTE(query.MinQScore))
	}

	total, err := q.Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count snapshots: %w", err)
	}

	// Apply ordering
	dir := orderTerm(query.Desc)
	switch query.OrderBy {
	case "synthesized_at":
		q = q.Order(entwordsnapshot.BySynthesizedAt(dir), entwordsnapshot.ByID(dir))
	case "term":
		q = q.Order(entwordsnapshot.ByTerm(dir), entwordsnapshot.ByID(dir))
	default:
		q = q.Order(entwordsnapshot.ByQscore(dir), entwordsnapshot.ByID(dir))
	}

	// Apply pagination
	pageSize := int(query.PageSize)
	if pageSize <= 0 {
		pageSize = 20
	}
	pageNo := int(query.PageNo)
	if pageNo <= 0 {
		pageNo = 1
	}
	q = q.Limit(pageSize).Offset((pageNo - 1) * pageSize)

	rows, err := q.All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list snapshots: %w", err)
	}

	snapshots := make([]*entity.WordSnapshot, len(rows))
	for i, row := range rows {
		snapshots[i] = mapEntWordSnapshot(row)
	}
	return snapshots, total, nil
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
		Language:            row.Language,
		WikidataQID:        row.WikidataQid,
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

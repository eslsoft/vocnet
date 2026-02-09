package repository

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqljson"

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

	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	latest, qerr := tx.WordSnapshot.Query().
		Where(
			entwordsnapshot.LemmaIDEQ(snapshot.LemmaID),
			entwordsnapshot.LatestEQ(true),
		).
		Order(entwordsnapshot.ByVersion(sql.OrderDesc())).
		First(ctx)
	if qerr != nil && !entdb.IsNotFound(qerr) {
		err = fmt.Errorf("query latest snapshot: %w", qerr)
		return nil, err
	}

	nextVersion := int32(1)
	if latest != nil {
		nextVersion = latest.Version + 1
		if _, uerr := tx.WordSnapshot.Update().
			Where(
				entwordsnapshot.LemmaIDEQ(snapshot.LemmaID),
				entwordsnapshot.LatestEQ(true),
			).
			SetLatest(false).
			Save(ctx); uerr != nil {
			err = fmt.Errorf("clear latest snapshot marker: %w", uerr)
			return nil, err
		}
	}

	create := tx.WordSnapshot.Create().
		SetLemmaID(snapshot.LemmaID).
		SetTerm(strings.ToLower(strings.TrimSpace(snapshot.Term))).
		SetTerms(snapshot.Terms).
		SetLanguage(snapshot.Language).
		SetLatest(true).
		SetVersion(nextVersion).
		SetData(snapshot.Data).
		SetQscore(snapshot.QScore).
		SetQscoreCompleteness(snapshot.QScoreCompleteness).
		SetQscoreDepth(snapshot.QScoreDepth).
		SetQscoreDensity(snapshot.QScoreDensity).
		SetQscoreValidity(snapshot.QScoreValidity).
		SetSynthesizedAt(snapshot.SynthesizedAt)
	if snapshot.JobID != nil {
		create.SetJobID(*snapshot.JobID)
	}

	row, cerr := create.Save(ctx)
	if cerr != nil {
		err = translateDBError(cerr, "word_snapshot")
		return nil, err
	}

	if cerr = tx.Commit(); cerr != nil {
		err = fmt.Errorf("commit snapshot tx: %w", cerr)
		return nil, err
	}
	return mapEntWordSnapshot(row), nil
}

func (r *wordSnapshotRepository) GetByLemma(ctx context.Context, lemmaID int64) (*entity.WordSnapshot, error) {
	row, err := r.client.WordSnapshot.Query().
		Where(
			entwordsnapshot.LemmaIDEQ(lemmaID),
			entwordsnapshot.LatestEQ(true),
		).
		Order(entwordsnapshot.ByVersion(sql.OrderDesc())).
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
	normalized := strings.ToLower(strings.TrimSpace(term))
	row, err := r.client.WordSnapshot.Query().
		Where(
			entwordsnapshot.LanguageEQ(language),
			entwordsnapshot.LatestEQ(true),
			func(s *sql.Selector) {
				column := s.C(entwordsnapshot.FieldTerms)
				s.Where(sqljson.ValueContains(column, normalized))
			},
		).
		Order(entwordsnapshot.ByVersion(sql.OrderDesc())).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, fmt.Errorf("get snapshot by term: %w", err)
	}
	return mapEntWordSnapshot(row), nil
}

func (r *wordSnapshotRepository) ListLatestByLemmaIDs(ctx context.Context, lemmaIDs []int64) (map[int64]*entity.WordSnapshot, error) {
	out := make(map[int64]*entity.WordSnapshot, len(lemmaIDs))
	if len(lemmaIDs) == 0 {
		return out, nil
	}

	rows, err := r.client.WordSnapshot.Query().
		Where(
			entwordsnapshot.LemmaIDIn(lemmaIDs...),
			entwordsnapshot.LatestEQ(true),
		).
		Order(entwordsnapshot.ByVersion(sql.OrderDesc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list latest snapshots by lemma ids: %w", err)
	}

	for _, row := range rows {
		if row == nil {
			continue
		}
		// Keep the first row per lemma (highest version because of ordering).
		if _, exists := out[row.LemmaID]; exists {
			continue
		}
		out[row.LemmaID] = mapEntWordSnapshot(row)
	}

	return out, nil
}

func (r *wordSnapshotRepository) ListLatest(ctx context.Context, pageNo int32, pageSize int32, keyword string) ([]*entity.WordSnapshot, int64, error) {
	if pageNo <= 0 {
		pageNo = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 10000 {
		pageSize = 10000
	}

	q := r.client.WordSnapshot.Query().
		Where(entwordsnapshot.LatestEQ(true))

	trimmedKeyword := strings.TrimSpace(keyword)
	if trimmedKeyword != "" {
		q = q.Where(entwordsnapshot.TermContainsFold(trimmedKeyword))
	}

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count latest snapshots: %w", err)
	}

	offset := int((pageNo - 1) * pageSize)
	rows, err := q.
		Order(entwordsnapshot.BySynthesizedAt(sql.OrderDesc()), entwordsnapshot.ByVersion(sql.OrderDesc())).
		Limit(int(pageSize)).
		Offset(offset).
		All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list latest snapshots: %w", err)
	}

	out := make([]*entity.WordSnapshot, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntWordSnapshot(row))
	}
	return out, int64(total), nil
}

func (r *wordSnapshotRepository) ListByLemmaID(ctx context.Context, lemmaID int64, pageNo int32, pageSize int32) ([]*entity.WordSnapshot, int64, error) {
	if lemmaID <= 0 {
		return nil, 0, entity.ErrInvalidInput
	}
	if pageNo <= 0 {
		pageNo = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 10000 {
		pageSize = 10000
	}

	q := r.client.WordSnapshot.Query().
		Where(entwordsnapshot.LemmaIDEQ(lemmaID))

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count snapshots by lemma id: %w", err)
	}

	offset := int((pageNo - 1) * pageSize)
	rows, err := q.
		Order(entwordsnapshot.ByVersion(sql.OrderDesc()), entwordsnapshot.ByCreatedAt(sql.OrderDesc())).
		Limit(int(pageSize)).
		Offset(offset).
		All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list snapshots by lemma id: %w", err)
	}

	out := make([]*entity.WordSnapshot, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntWordSnapshot(row))
	}
	return out, int64(total), nil
}

func mapEntWordSnapshot(row *entdb.WordSnapshot) *entity.WordSnapshot {
	if row == nil {
		return nil
	}
	return &entity.WordSnapshot{
		ID:                 row.ID,
		LemmaID:            row.LemmaID,
		JobID:              row.JobID,
		Term:               row.Term,
		Terms:              row.Terms,
		Language:           row.Language,
		Latest:             row.Latest,
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

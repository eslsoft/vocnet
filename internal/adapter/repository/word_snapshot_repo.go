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

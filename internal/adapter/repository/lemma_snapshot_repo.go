package repository

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqljson"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlemmasnapshot "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemmasnapshot"
	"github.com/eslsoft/vocnet/internal/repository"
)

type lemmaSnapshotRepository struct {
	client *entdb.Client
}

func NewLemmaSnapshotRepository(client *entdb.Client) repository.LemmaSnapshotRepository {
	return &lemmaSnapshotRepository{client: client}
}

func (r *lemmaSnapshotRepository) CreateOrUpdate(ctx context.Context, snapshot *entity.LemmaSnapshot) (*entity.LemmaSnapshot, error) {
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

	latest, qerr := tx.LemmaSnapshot.Query().
		Where(
			entlemmasnapshot.LemmaIDEQ(snapshot.LemmaID),
			entlemmasnapshot.IsLatestEQ(true),
		).
		Order(entlemmasnapshot.ByVersion(sql.OrderDesc())).
		First(ctx)
	if qerr != nil && !entdb.IsNotFound(qerr) {
		err = fmt.Errorf("query latest snapshot: %w", qerr)
		return nil, err
	}

	nextVersion := int32(1)
	if latest != nil {
		nextVersion = latest.Version + 1
		if _, uerr := tx.LemmaSnapshot.Update().
			Where(
				entlemmasnapshot.LemmaIDEQ(snapshot.LemmaID),
				entlemmasnapshot.IsLatestEQ(true),
			).
			SetIsLatest(false).
			Save(ctx); uerr != nil {
			err = fmt.Errorf("clear latest snapshot marker: %w", uerr)
			return nil, err
		}
	}

	create := tx.LemmaSnapshot.Create().
		SetLemmaID(snapshot.LemmaID).
		SetSurface(snapshot.Surface).
		SetNormalized(strings.ToLower(strings.TrimSpace(snapshot.Normalized))).
		SetLookupTerms(snapshot.LookupTerms).
		SetLanguage(snapshot.Language).
		SetIsLatest(true).
		SetVersion(nextVersion).
		SetSchemaVersion(snapshot.SchemaVersion).
		SetPayload(snapshot.Payload).
		SetQualityOverall(snapshot.Quality.Overall).
		SetQualityCompleteness(snapshot.Quality.Completeness).
		SetQualityDepth(snapshot.Quality.Depth).
		SetQualityDensity(snapshot.Quality.Density).
		SetQualityValidity(snapshot.Quality.Validity).
		SetLexemeCount(snapshot.LexemeCount).
		SetSenseCount(snapshot.SenseCount).
		SetFormCount(snapshot.FormCount).
		SetRelationCount(snapshot.RelationCount).
		SetProviderCount(snapshot.ProviderCount).
		SetSynthesizedAt(snapshot.SynthesizedAt)
	if snapshot.JobID != nil {
		create.SetJobID(*snapshot.JobID)
	}

	row, cerr := create.Save(ctx)
	if cerr != nil {
		err = translateDBError(cerr, "lemma_snapshot")
		return nil, err
	}

	if cerr = tx.Commit(); cerr != nil {
		err = fmt.Errorf("commit snapshot tx: %w", cerr)
		return nil, err
	}
	return mapEntLemmaSnapshot(row), nil
}

func (r *lemmaSnapshotRepository) GetByLemma(ctx context.Context, lemmaID int64) (*entity.LemmaSnapshot, error) {
	row, err := r.client.LemmaSnapshot.Query().
		Where(
			entlemmasnapshot.LemmaIDEQ(lemmaID),
			entlemmasnapshot.IsLatestEQ(true),
		).
		Order(entlemmasnapshot.ByVersion(sql.OrderDesc())).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, fmt.Errorf("get snapshot by lemma: %w", err)
	}
	return mapEntLemmaSnapshot(row), nil
}

func (r *lemmaSnapshotRepository) GetByTerm(ctx context.Context, term string, language string) (*entity.LemmaSnapshot, error) {
	normalized := strings.ToLower(strings.TrimSpace(term))
	row, err := r.client.LemmaSnapshot.Query().
		Where(
			entlemmasnapshot.LanguageEQ(language),
			entlemmasnapshot.IsLatestEQ(true),
			func(s *sql.Selector) {
				column := s.C(entlemmasnapshot.FieldLookupTerms)
				s.Where(sqljson.ValueContains(column, normalized))
			},
		).
		Order(entlemmasnapshot.ByVersion(sql.OrderDesc())).
		First(ctx)
	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, entity.ErrWordNotFound
		}
		return nil, fmt.Errorf("get snapshot by term: %w", err)
	}
	return mapEntLemmaSnapshot(row), nil
}

func (r *lemmaSnapshotRepository) ListLatestByLemmaIDs(ctx context.Context, lemmaIDs []int64) (map[int64]*entity.LemmaSnapshot, error) {
	out := make(map[int64]*entity.LemmaSnapshot, len(lemmaIDs))
	if len(lemmaIDs) == 0 {
		return out, nil
	}

	rows, err := r.client.LemmaSnapshot.Query().
		Where(
			entlemmasnapshot.LemmaIDIn(lemmaIDs...),
			entlemmasnapshot.IsLatestEQ(true),
		).
		Order(entlemmasnapshot.ByVersion(sql.OrderDesc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list latest snapshots by lemma ids: %w", err)
	}

	for _, row := range rows {
		if row == nil {
			continue
		}
		if _, exists := out[row.LemmaID]; exists {
			continue
		}
		out[row.LemmaID] = mapEntLemmaSnapshot(row)
	}

	return out, nil
}

func (r *lemmaSnapshotRepository) ListLatest(ctx context.Context, pageNo int32, pageSize int32, keyword string) ([]*entity.LemmaSnapshot, int64, error) {
	if pageNo <= 0 {
		pageNo = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 10000 {
		pageSize = 10000
	}

	q := r.client.LemmaSnapshot.Query().
		Where(entlemmasnapshot.IsLatestEQ(true))

	trimmedKeyword := strings.TrimSpace(keyword)
	if trimmedKeyword != "" {
		q = q.Where(entlemmasnapshot.SurfaceContainsFold(trimmedKeyword))
	}

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count latest snapshots: %w", err)
	}

	offset := int((pageNo - 1) * pageSize)
	rows, err := q.
		Order(entlemmasnapshot.BySynthesizedAt(sql.OrderDesc()), entlemmasnapshot.ByVersion(sql.OrderDesc())).
		Limit(int(pageSize)).
		Offset(offset).
		All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list latest snapshots: %w", err)
	}

	out := make([]*entity.LemmaSnapshot, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntLemmaSnapshot(row))
	}
	return out, int64(total), nil
}

func (r *lemmaSnapshotRepository) ListByLemmaID(ctx context.Context, lemmaID int64, pageNo int32, pageSize int32) ([]*entity.LemmaSnapshot, int64, error) {
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

	q := r.client.LemmaSnapshot.Query().
		Where(entlemmasnapshot.LemmaIDEQ(lemmaID))

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count snapshots by lemma id: %w", err)
	}

	offset := int((pageNo - 1) * pageSize)
	rows, err := q.
		Order(entlemmasnapshot.ByVersion(sql.OrderDesc()), entlemmasnapshot.ByCreatedAt(sql.OrderDesc())).
		Limit(int(pageSize)).
		Offset(offset).
		All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list snapshots by lemma id: %w", err)
	}

	out := make([]*entity.LemmaSnapshot, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapEntLemmaSnapshot(row))
	}
	return out, int64(total), nil
}

func mapEntLemmaSnapshot(row *entdb.LemmaSnapshot) *entity.LemmaSnapshot {
	if row == nil {
		return nil
	}
	return &entity.LemmaSnapshot{
		ID:            row.ID,
		LemmaID:       row.LemmaID,
		JobID:         row.JobID,
		Surface:       row.Surface,
		Normalized:    row.Normalized,
		LookupTerms:   row.LookupTerms,
		Language:      row.Language,
		IsLatest:      row.IsLatest,
		Version:       row.Version,
		SchemaVersion: row.SchemaVersion,
		Payload:       row.Payload,
		Quality: entity.QualityScore{
			Overall:      row.QualityOverall,
			Completeness: row.QualityCompleteness,
			Depth:        row.QualityDepth,
			Density:      row.QualityDensity,
			Validity:     row.QualityValidity,
		},
		LexemeCount:   row.LexemeCount,
		SenseCount:    row.SenseCount,
		FormCount:     row.FormCount,
		RelationCount: row.RelationCount,
		ProviderCount: row.ProviderCount,
		SynthesizedAt: row.SynthesizedAt,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
}

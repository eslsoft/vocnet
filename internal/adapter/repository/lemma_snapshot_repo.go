package repository

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqljson"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlemma "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"
	entlemmasnapshot "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemmasnapshot"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/util"
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

	variants := snapshot.Variants
	if variants == nil {
		variants = []string{}
	}
	create := tx.LemmaSnapshot.Create().
		SetLemmaID(snapshot.LemmaID).
		SetSurface(snapshot.Surface).
		SetNormalized(strings.ToLower(strings.TrimSpace(snapshot.Normalized))).
		SetVariants(variants).
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
		WithLemma().
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
	q := r.client.LemmaSnapshot.Query().
		Where(
			entlemmasnapshot.IsLatestEQ(true),
			func(s *sql.Selector) {
				column := s.C(entlemmasnapshot.FieldLookupTerms)
				s.Where(sqljson.ValueContains(column, normalized))
			},
		)
	if language != "" {
		q = q.Where(entlemmasnapshot.LanguageEQ(language))
	}
	rows, err := q.WithLemma().All(ctx)
	if err != nil {
		return nil, fmt.Errorf("get snapshot by term: %w", err)
	}
	if len(rows) == 0 {
		return nil, entity.ErrWordNotFound
	}
	if len(rows) == 1 {
		return mapEntLemmaSnapshot(rows[0]), nil
	}

	// Multiple snapshots contain this term — pick the best match deterministically.
	best := rows[0]
	for _, row := range rows[1:] {
		best = preferSnapshot(best, row, normalized)
	}
	return mapEntLemmaSnapshot(best), nil
}

// preferSnapshot picks the better snapshot for a given query term.
// Priority:
//  1. Snapshot that lists query as a non-LEMMA form in payload (base form's snapshot)
//  2. Among non-exact: longest prefix strictly shorter than query
//  3. Exact surface match
//  4. Shortest surface
//  5. Highest quality score
//  6. Lower LemmaID (deterministic tiebreaker)
func preferSnapshot(a, b *entdb.LemmaSnapshot, query string) *entdb.LemmaSnapshot {
	aNorm := strings.ToLower(strings.TrimSpace(a.Normalized))
	bNorm := strings.ToLower(strings.TrimSpace(b.Normalized))

	// Priority 1: snapshot whose forms list the query as a regular inflection wins.
	// This covers both prefix forms (walk→walking) and non-prefix forms (define→defining).
	aIsBase := isRegularBaseOf(a.Payload.Forms, aNorm, query)
	bIsBase := isRegularBaseOf(b.Payload.Forms, bNorm, query)
	if aIsBase != bIsBase {
		if aIsBase {
			return a
		}
		return b
	}

	// Priority 2: among base candidates, longest prefix is closest match.
	aIsPrefix := len(aNorm) < len(query) && strings.HasPrefix(query, aNorm)
	bIsPrefix := len(bNorm) < len(query) && strings.HasPrefix(query, bNorm)
	if aIsPrefix != bIsPrefix {
		if aIsPrefix {
			return a
		}
		return b
	}
	if aIsPrefix && bIsPrefix && len(aNorm) != len(bNorm) {
		if len(aNorm) > len(bNorm) {
			return a
		}
		return b
	}

	// Priority 3: exact surface match.
	aExact := aNorm == query
	bExact := bNorm == query
	if aExact != bExact {
		if aExact {
			return a
		}
		return b
	}

	// Priority 4: shortest surface.
	if len(aNorm) != len(bNorm) {
		if len(aNorm) < len(bNorm) {
			return a
		}
		return b
	}

	// Priority 5: highest quality score.
	if a.QualityOverall != b.QualityOverall {
		if a.QualityOverall > b.QualityOverall {
			return a
		}
		return b
	}

	// Priority 6: lower LemmaID (deterministic tiebreaker).
	if a.LemmaID <= b.LemmaID {
		return a
	}
	return b
}

// isRegularBaseOf checks if query appears as a regular inflection in the snapshot's forms.
// Uses the same morphological rules as IsIrregularForm to stay consistent.
func isRegularBaseOf(forms []entity.LemmaSnapshotForm, lemma, query string) bool {
	for i := range forms {
		f := &forms[i]
		if strings.ToLower(f.Surface) != query {
			continue
		}
		formType := entity.FormType(strings.ToUpper(f.FormType))
		if !isKnownInflectionType(formType) {
			continue
		}
		if !util.IsIrregularForm(lemma, query, formType) {
			return true
		}
	}
	return false
}

// isKnownInflectionType returns true for form types that IsIrregularForm can evaluate.
func isKnownInflectionType(ft entity.FormType) bool {
	switch ft {
	case entity.FormTypePlural,
		entity.FormTypePast,
		entity.FormTypePastParticiple,
		entity.FormTypePresentParticiple,
		entity.FormTypeThirdPersonSingular,
		entity.FormTypeComparative,
		entity.FormTypeSuperlative:
		return true
	}
	return false
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
		WithLemma().
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

func (r *lemmaSnapshotRepository) ListLatest(ctx context.Context, query *repository.ListLatestLemmaSnapshotsQuery) ([]*entity.LemmaSnapshot, int64, error) {
	if query == nil {
		query = &repository.ListLatestLemmaSnapshotsQuery{}
	}
	if query.PageNo <= 0 {
		query.PageNo = 1
	}
	if query.PageSize <= 0 {
		query.PageSize = 20
	}
	if query.PageSize > 10000 {
		query.PageSize = 10000
	}

	q := r.client.LemmaSnapshot.Query().
		Where(entlemmasnapshot.IsLatestEQ(true)).
		WithLemma()

	trimmedKeyword := strings.TrimSpace(query.Keyword)
	if trimmedKeyword != "" {
		// Search in both surface (lemma) and lookup_terms (all forms)
		q = q.Where(func(s *sql.Selector) {
			normalizedKeyword := strings.ToLower(trimmedKeyword)
			surfaceCol := s.C(entlemmasnapshot.FieldSurface)
			lookupCol := s.C(entlemmasnapshot.FieldLookupTerms)
			s.Where(sql.Or(
				sql.ContainsFold(surfaceCol, trimmedKeyword),
				sqljson.ValueContains(lookupCol, normalizedKeyword),
			))
		})
	}
	if query.MinQScore != nil {
		q = q.Where(entlemmasnapshot.QualityOverallGTE(*query.MinQScore))
	}
	if len(query.Categories) > 0 {
		q = q.Where(containsAnyJSONField(entlemmasnapshot.FieldPayload, "categories", query.Categories))
	}
	if len(query.Levels) > 0 {
		levels := make([]string, 0, len(query.Levels))
		for _, level := range query.Levels {
			trimmed := strings.TrimSpace(level)
			if trimmed == "" {
				continue
			}
			levels = append(levels, strings.ToUpper(trimmed))
		}
		if len(levels) > 0 {
			q = q.Where(entlemmasnapshot.HasLemmaWith(entlemma.LevelIn(levels...)))
		}
	}
	if len(query.POS) > 0 {
		q = q.Where(containsAnyPOS(entlemmasnapshot.FieldPayload, query.POS))
	}

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count latest snapshots: %w", err)
	}

	offset := int((query.PageNo - 1) * query.PageSize)
	rows, err := applyListLatestSort(q, query.SortBy, query.SortDesc).
		Limit(int(query.PageSize)).
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

func containsAnyJSONField(column, jsonPath string, values []string) func(*sql.Selector) {
	return func(s *sql.Selector) {
		preds := make([]*sql.Predicate, 0, len(values))
		for _, value := range values {
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				continue
			}
			preds = append(preds, sqljson.ValueContains(s.C(column), trimmed, sqljson.Path(jsonPath)))
		}
		if len(preds) > 0 {
			s.Where(sql.Or(preds...))
		}
	}
}

func containsAnyPOS(column string, posValues []string) func(*sql.Selector) {
	return func(s *sql.Selector) {
		preds := make([]*sql.Predicate, 0, len(posValues))
		for _, pos := range posValues {
			trimmed := strings.TrimSpace(pos)
			if trimmed == "" {
				continue
			}
			preds = append(preds, sqljson.ValueContains(s.C(column), map[string]string{"pos": trimmed}, sqljson.Path("lexemes")))
		}
		if len(preds) > 0 {
			s.Where(sql.Or(preds...))
		}
	}
}

func applyListLatestSort(q *entdb.LemmaSnapshotQuery, sortBy string, desc bool) *entdb.LemmaSnapshotQuery {
	order := sql.OrderAsc()
	if desc {
		order = sql.OrderDesc()
	}
	switch strings.TrimSpace(sortBy) {
	case "surface":
		return q.Order(entlemmasnapshot.BySurface(order), entlemmasnapshot.ByVersion(sql.OrderDesc()))
	case "quality_overall":
		return q.Order(entlemmasnapshot.ByQualityOverall(order), entlemmasnapshot.BySynthesizedAt(sql.OrderDesc()))
	case "updated_at":
		return q.Order(entlemmasnapshot.ByUpdatedAt(order), entlemmasnapshot.ByVersion(sql.OrderDesc()))
	case "created_at":
		return q.Order(entlemmasnapshot.ByCreatedAt(order), entlemmasnapshot.ByVersion(sql.OrderDesc()))
	case "synthesized_at":
		return q.Order(entlemmasnapshot.BySynthesizedAt(order), entlemmasnapshot.ByVersion(sql.OrderDesc()))
	default:
		return q.Order(entlemmasnapshot.BySynthesizedAt(sql.OrderDesc()), entlemmasnapshot.ByVersion(sql.OrderDesc()))
	}
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
		Where(entlemmasnapshot.LemmaIDEQ(lemmaID)).
		WithLemma()

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
	level := ""
	if row.Edges.Lemma != nil {
		level = row.Edges.Lemma.Level
	}
	return &entity.LemmaSnapshot{
		ID:            row.ID,
		LemmaID:       row.LemmaID,
		JobID:         row.JobID,
		Surface:       row.Surface,
		Normalized:    row.Normalized,
		Level:         level,
		Variants:      row.Variants,
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

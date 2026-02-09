package pipeline

import (
	"context"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// LemmaQueryService provides read-only lemma queries for pipeline-related APIs.
type LemmaQueryService struct {
	lemmaRepo    repository.LemmaRepository
	snapshotRepo repository.WordSnapshotRepository
}

func NewLemmaQueryService(lemmaRepo repository.LemmaRepository, snapshotRepo repository.WordSnapshotRepository) *LemmaQueryService {
	return &LemmaQueryService{lemmaRepo: lemmaRepo, snapshotRepo: snapshotRepo}
}

type ListLemmasQuery struct {
	PageNo   int32
	PageSize int32
	Keyword  string
}

type ListSnapshotsQuery struct {
	LemmaID  int64
	PageNo   int32
	PageSize int32
}

type LemmaListItem struct {
	Lemma    *entity.Lemma
	Snapshot *entity.WordSnapshot
}

func (s *LemmaQueryService) ListLemmas(ctx context.Context, query *ListLemmasQuery) ([]*LemmaListItem, int64, error) {
	if query == nil {
		query = &ListLemmasQuery{}
	}

	snapshots, total, err := s.snapshotRepo.ListLatest(ctx, query.PageNo, query.PageSize, query.Keyword)
	if err != nil {
		return nil, 0, err
	}

	items := make([]*LemmaListItem, 0, len(snapshots))
	for _, snapshot := range snapshots {
		if snapshot == nil {
			continue
		}

		lemma, err := s.lemmaRepo.GetByID(ctx, snapshot.LemmaID)
		if err != nil {
			// Snapshot is the source of truth for this list endpoint.
			// If lemma row is missing, return a minimal placeholder.
			lemma = &entity.Lemma{
				ID:         snapshot.LemmaID,
				Surface:    snapshot.Term,
				Normalized: strings.ToLower(snapshot.Term),
			}
		}

		items = append(items, &LemmaListItem{
			Lemma:    lemma,
			Snapshot: snapshot,
		})
	}

	return items, total, nil
}

func (s *LemmaQueryService) ListSnapshots(ctx context.Context, query *ListSnapshotsQuery) ([]*entity.WordSnapshot, int64, error) {
	if query == nil || query.LemmaID <= 0 {
		return nil, 0, entity.ErrInvalidInput
	}
	return s.snapshotRepo.ListByLemmaID(ctx, query.LemmaID, query.PageNo, query.PageSize)
}

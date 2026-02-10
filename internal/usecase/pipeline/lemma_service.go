package pipeline

import (
	"context"

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

func (s *LemmaQueryService) ListLemmas(ctx context.Context, query *ListLemmasQuery) ([]*entity.WordSnapshot, int64, error) {
	if query == nil {
		query = &ListLemmasQuery{}
	}

	snapshots, total, err := s.snapshotRepo.ListLatest(ctx, query.PageNo, query.PageSize, query.Keyword)
	if err != nil {
		return nil, 0, err
	}

	return snapshots, total, nil
}

func (s *LemmaQueryService) ListSnapshots(ctx context.Context, query *ListSnapshotsQuery) ([]*entity.WordSnapshot, int64, error) {
	if query == nil || query.LemmaID <= 0 {
		return nil, 0, entity.ErrInvalidInput
	}
	return s.snapshotRepo.ListByLemmaID(ctx, query.LemmaID, query.PageNo, query.PageSize)
}

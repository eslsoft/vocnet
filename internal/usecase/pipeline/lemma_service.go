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

type LemmaListItem struct {
	Lemma    *entity.Lemma
	Snapshot *entity.WordSnapshot
}

func (s *LemmaQueryService) ListLemmas(ctx context.Context, query *ListLemmasQuery) ([]*LemmaListItem, int64, error) {
	if query == nil {
		query = &ListLemmasQuery{}
	}

	pageNo := query.PageNo
	if pageNo <= 0 {
		pageNo = 1
	}
	pageSize := query.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 10000 {
		pageSize = 10000
	}

	lemmas, total, err := s.lemmaRepo.List(ctx, &repository.ListWordsQuery{
		Pagination: repository.Pagination{
			PageNo:   pageNo,
			PageSize: pageSize,
		},
		Keyword: strings.TrimSpace(query.Keyword),
	})
	if err != nil {
		return nil, 0, err
	}

	lemmaIDs := make([]int64, 0, len(lemmas))
	for _, lemma := range lemmas {
		if lemma == nil {
			continue
		}
		lemmaIDs = append(lemmaIDs, lemma.ID)
	}

	snapshotByLemmaID, err := s.snapshotRepo.ListLatestByLemmaIDs(ctx, lemmaIDs)
	if err != nil {
		return nil, 0, err
	}

	items := make([]*LemmaListItem, 0, len(lemmas))
	for _, lemma := range lemmas {
		if lemma == nil {
			continue
		}
		items = append(items, &LemmaListItem{
			Lemma:    lemma,
			Snapshot: snapshotByLemmaID[lemma.ID],
		})
	}

	return items, total, nil
}

package pipeline

import (
	"context"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// LemmaQueryService provides read-only lemma queries for pipeline-related APIs.
type LemmaQueryService struct {
	lemmaRepo repository.LemmaRepository
}

func NewLemmaQueryService(lemmaRepo repository.LemmaRepository) *LemmaQueryService {
	return &LemmaQueryService{lemmaRepo: lemmaRepo}
}

type ListLemmasQuery struct {
	PageNo   int32
	PageSize int32
	Keyword  string
}

func (s *LemmaQueryService) ListLemmas(ctx context.Context, query *ListLemmasQuery) ([]*entity.Lemma, int64, error) {
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

	return s.lemmaRepo.List(ctx, &repository.ListWordsQuery{
		Pagination: repository.Pagination{
			PageNo:   pageNo,
			PageSize: pageSize,
		},
		Keyword: strings.TrimSpace(query.Keyword),
	})
}

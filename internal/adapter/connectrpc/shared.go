package connectrpc

import (
	"github.com/eslsoft/vocnet/internal/repository"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
)

const _maxPageSize = 10000

func convertPagination(p *commonv1.PaginationRequest) repository.Pagination {
	pageNo := p.GetPageNo()
	if pageNo <= 0 {
		pageNo = 1
	}
	pageSize := p.GetPageSize()
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > _maxPageSize {
		pageSize = _maxPageSize
	}

	return repository.Pagination{PageNo: pageNo, PageSize: pageSize}
}

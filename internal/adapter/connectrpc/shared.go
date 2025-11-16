package connectrpc

import (
	"github.com/eslsoft/vocnet/internal/repository"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
)

const (
	_maxPageSize     = 10000
	_defaultPageNo   = 1
	_defaultPageSize = 20
)

func convertPagination(p *commonv1.PaginationRequest) repository.Pagination {
	if p == nil {
		return repository.Pagination{PageNo: _defaultPageNo, PageSize: _defaultPageSize}
	}

	pageNo := p.GetPageNo()
	if pageNo <= 0 {
		pageNo = _defaultPageNo
	}
	pageSize := p.GetPageSize()
	if pageSize <= 0 {
		pageSize = _defaultPageSize
	}
	if pageSize > _maxPageSize {
		pageSize = _maxPageSize
	}

	return repository.Pagination{PageNo: pageNo, PageSize: pageSize}
}

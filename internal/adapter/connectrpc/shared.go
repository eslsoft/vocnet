package connectrpc

import (
	"net/http"
	"strconv"
	"strings"

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

func userIDFromHeader(h http.Header) int64 {
	if h == nil {
		return 0
	}
	raw := strings.TrimSpace(h.Get("x-user-id"))
	if raw == "" {
		return 0
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0
	}
	return id
}

package connectrpc

import (
	"context"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/entity"
	pipelineuc "github.com/eslsoft/vocnet/internal/usecase/pipeline"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
)

var _ dictv1connect.LemmaServiceHandler = (*LemmaServiceServer)(nil)

type LemmaServiceServer struct {
	dictv1connect.UnimplementedLemmaServiceHandler
	lemmaUC *pipelineuc.LemmaQueryService
}

func NewLemmaServiceServer(lemmaUC *pipelineuc.LemmaQueryService) *LemmaServiceServer {
	return &LemmaServiceServer{lemmaUC: lemmaUC}
}

func (s *LemmaServiceServer) ListLemmas(ctx context.Context, req *connect.Request[dictv1.ListLemmasRequest]) (*connect.Response[dictv1.ListLemmasResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}

	pagination := convertPagination(req.Msg.GetPagination())
	items, total, err := s.lemmaUC.ListLemmas(ctx, &pipelineuc.ListLemmasQuery{
		PageNo:   pagination.PageNo,
		PageSize: pagination.PageSize,
		Keyword:  req.Msg.GetKeyword(),
	})
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	resp := &dictv1.ListLemmasResponse{
		Pagination: &commonv1.PaginationResponse{Total: int32(total), PageNo: pagination.PageNo}, // nolint:gosec
		Lemmas:     make([]*dictv1.Lemma, 0, len(items)),
	}
	for _, item := range items {
		resp.Lemmas = append(resp.Lemmas, toPBLemma(item.Lemma, item.Snapshot))
	}

	return connect.NewResponse(resp), nil
}

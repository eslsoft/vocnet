package connectrpc

import (
	"context"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/entity"
	pipelineuc "github.com/eslsoft/vocnet/internal/usecase/pipeline"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	pipelinev1 "github.com/eslsoft/vocnet/pkg/api/pipeline/v1"
	"github.com/eslsoft/vocnet/pkg/api/pipeline/v1/pipelinev1connect"
)

var _ pipelinev1connect.LemmaServiceHandler = (*LemmaServiceServer)(nil)

type LemmaServiceServer struct {
	pipelinev1connect.UnimplementedLemmaServiceHandler
	lemmaUC *pipelineuc.LemmaQueryService
}

func NewLemmaServiceServer(lemmaUC *pipelineuc.LemmaQueryService) *LemmaServiceServer {
	return &LemmaServiceServer{lemmaUC: lemmaUC}
}

func (s *LemmaServiceServer) ListLemmas(ctx context.Context, req *connect.Request[pipelinev1.ListLemmasRequest]) (*connect.Response[pipelinev1.ListLemmasResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}

	pagination := convertPagination(req.Msg.GetPagination())
	lemmas, total, err := s.lemmaUC.ListLemmas(ctx, &pipelineuc.ListLemmasQuery{
		PageNo:   pagination.PageNo,
		PageSize: pagination.PageSize,
		Keyword:  req.Msg.GetKeyword(),
	})
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	resp := &pipelinev1.ListLemmasResponse{
		Pagination: &commonv1.PaginationResponse{Total: int32(total), PageNo: pagination.PageNo}, // nolint:gosec
		Lemmas:     make([]*pipelinev1.LemmaItem, 0, len(lemmas)),
	}
	for _, lemma := range lemmas {
		resp.Lemmas = append(resp.Lemmas, toPBLemmaItem(lemma))
	}

	return connect.NewResponse(resp), nil
}

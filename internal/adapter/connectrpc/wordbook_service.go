package connectrpc

import (
	"context"

	"connectrpc.com/connect"
	"github.com/samber/lo"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	wordbookv1 "github.com/eslsoft/vocnet/pkg/api/wordbook/v1"
	"github.com/eslsoft/vocnet/pkg/api/wordbook/v1/wordbookv1connect"
	"github.com/eslsoft/vocnet/pkg/filterexpr"
	"github.com/eslsoft/vocnet/pkg/safeconv"
)

var _ wordbookv1connect.WordbookServiceHandler = (*WordbookServiceServer)(nil)

type WordbookServiceServer struct {
	wordbookv1connect.UnimplementedWordbookServiceHandler
	uc usecase.WordbookUsecase
}

func NewWordbookServiceServer(uc usecase.WordbookUsecase) *WordbookServiceServer {
	return &WordbookServiceServer{uc: uc}
}

func (s *WordbookServiceServer) CreateWordbook(ctx context.Context, req *connect.Request[wordbookv1.CreateWordbookRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	if req.Msg == nil {
		return nil, mapping.ToPbError(entity.ErrInvalidInput)
	}
	entBook := mapping.ToEntityWordbook(&wordbookv1.Wordbook{
		Language:    req.Msg.GetLanguage(),
		Visibility:  req.Msg.GetVisibility(),
		Name:        req.Msg.GetName(),
		Description: req.Msg.GetDescription(),
		Annotations: req.Msg.GetAnnotations(),
	})
	created, err := s.uc.Create(ctx, entBook)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}
	return connect.NewResponse(mapping.ToPbWordbook(created)), nil
}

func (s *WordbookServiceServer) UpdateWordbook(ctx context.Context, req *connect.Request[wordbookv1.UpdateWordbookRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	if req.Msg == nil || req.Msg.GetId() == 0 {
		return nil, mapping.ToPbError(entity.ErrInvalidWordbookID)
	}
	entBook := mapping.ToEntityWordbook(&wordbookv1.Wordbook{
		Id:          req.Msg.GetId(),
		Visibility:  req.Msg.GetVisibility(),
		Name:        req.Msg.GetName(),
		Description: req.Msg.GetDescription(),
		Annotations: req.Msg.GetAnnotations(),
	})
	updated, err := s.uc.Update(ctx, entBook)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}
	return connect.NewResponse(mapping.ToPbWordbook(updated)), nil
}

func (s *WordbookServiceServer) DeleteWordbook(ctx context.Context, req *connect.Request[commonv1.IDRequest]) (*connect.Response[emptypb.Empty], error) {
	wordbookID, err := extractID(req, entity.ErrInvalidWordbookID)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	if err := s.uc.Delete(ctx, wordbookID); err != nil {
		return nil, mapping.ToPbError(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (s *WordbookServiceServer) GetWordbook(ctx context.Context, req *connect.Request[commonv1.IDRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	wordbookID, err := extractID(req, entity.ErrInvalidWordbookID)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	book, err := s.uc.Get(ctx, wordbookID)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}
	return connect.NewResponse(mapping.ToPbWordbook(book)), nil
}

func (s *WordbookServiceServer) ListWordbooks(ctx context.Context, req *connect.Request[wordbookv1.ListWordbooksRequest]) (*connect.Response[wordbookv1.ListWordbooksResponse], error) {
	if req.Msg == nil {
		req.Msg = &wordbookv1.ListWordbooksRequest{}
	}
	params := repository.ListWordbookQuery{
		Pagination:     convertPagination(req.Msg.GetPagination()),
		IncludeBuiltin: true,
	}
	if err := filterexpr.Bind(req.Msg, &params, listWordbooksSchema); err != nil {
		return nil, err
	}

	items, total, err := s.uc.List(ctx, &params)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	resp := &wordbookv1.ListWordbooksResponse{
		Pagination: &commonv1.PaginationResponse{
			Total:  safeconv.Int64ToInt32(total),
			PageNo: params.PageNo,
		},
		Wordbooks: lo.Map(items, func(item *entity.Wordbook, _ int) *wordbookv1.Wordbook {
			return mapping.ToPbWordbook(item)
		}),
	}
	return connect.NewResponse(resp), nil
}

func (s *WordbookServiceServer) AddWords(ctx context.Context, req *connect.Request[wordbookv1.WordsActionRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	return s.handleWords(ctx, req, s.uc.AddWords)
}

func (s *WordbookServiceServer) RemoveWords(ctx context.Context, req *connect.Request[wordbookv1.WordsActionRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	return s.handleWords(ctx, req, s.uc.RemoveWords)
}

func (s *WordbookServiceServer) handleWords(
	ctx context.Context,
	req *connect.Request[wordbookv1.WordsActionRequest],
	action func(context.Context, int64, []string) (*entity.Wordbook, error),
) (*connect.Response[wordbookv1.Wordbook], error) {
	wordbookID, terms, err := extractWordbookAction(req)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	updated, err := action(ctx, wordbookID, terms)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbWordbook(updated)), nil
}

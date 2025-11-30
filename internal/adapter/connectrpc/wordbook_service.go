package connectrpc

import (
	"context"

	"connectrpc.com/connect"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	wordbookv1 "github.com/eslsoft/vocnet/pkg/api/wordbook/v1"
	"github.com/eslsoft/vocnet/pkg/api/wordbook/v1/wordbookv1connect"
	"github.com/eslsoft/vocnet/pkg/wordbook"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

var _ wordbookv1connect.WordbookServiceHandler = (*WordbookServiceServer)(nil)

type WordbookServiceServer struct {
	wordbookv1connect.UnimplementedWordbookServiceHandler
}

func NewWordbookServiceServer() *WordbookServiceServer {
	return &WordbookServiceServer{}
}

// ListWordbooks returns all builtin wordbooks
func (s *WordbookServiceServer) ListWordbooks(ctx context.Context, req *connect.Request[wordbookv1.ListWordbooksRequest]) (*connect.Response[wordbookv1.ListWordbooksResponse], error) {
	// Get all builtin wordbooks
	builtinWordbooks := wordbook.GetBuiltinWordbooks()

	// TODO: Apply filtering and sorting when user-created wordbooks are supported
	// For now, just return all builtin wordbooks

	// Handle pagination
	pagination := req.Msg.GetPagination()
	pageSize := int32(20) // default page size
	pageNo := int32(1)    // default page number

	if pagination != nil {
		if pagination.PageSize > 0 {
			pageSize = pagination.PageSize
		}
		if pagination.PageNo > 0 {
			pageNo = pagination.PageNo
		}
	}

	// Calculate pagination
	total := int32(len(builtinWordbooks))
	startIdx := (pageNo - 1) * pageSize
	endIdx := startIdx + pageSize

	if startIdx >= total {
		startIdx = 0
		endIdx = 0
	} else if endIdx > total {
		endIdx = total
	}

	// Slice wordbooks for current page
	var pageWordbooks []*wordbookv1.Wordbook
	if startIdx < endIdx {
		for i := startIdx; i < endIdx; i++ {
			pageWordbooks = append(pageWordbooks, &builtinWordbooks[i])
		}
	} else {
		pageWordbooks = []*wordbookv1.Wordbook{}
	}

	resp := &wordbookv1.ListWordbooksResponse{
		Pagination: &commonv1.PaginationResponse{
			Total:  total,
			PageNo: pageNo,
		},
		Wordbooks: pageWordbooks,
	}

	return connect.NewResponse(resp), nil
}

// GetWordbook returns a specific builtin wordbook by ID
func (s *WordbookServiceServer) GetWordbook(ctx context.Context, req *connect.Request[commonv1.IDRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	if req.Msg == nil || req.Msg.GetId() == 0 {
		return nil, status.Error(codes.InvalidArgument, "id required")
	}

	requestedID := req.Msg.GetId()

	// Search for the wordbook in builtin list
	builtinWordbooks := wordbook.GetBuiltinWordbooks()
	for i := range builtinWordbooks {
		if builtinWordbooks[i].Id == requestedID {
			return connect.NewResponse(&builtinWordbooks[i]), nil
		}
	}

	return nil, status.Errorf(codes.NotFound, "wordbook with id %d not found", requestedID)
}

// CreateWordbook is not implemented for builtin wordbooks
func (s *WordbookServiceServer) CreateWordbook(ctx context.Context, req *connect.Request[wordbookv1.CreateWordbookRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	return nil, status.Error(codes.Unimplemented, "creating wordbooks is not yet supported")
}

// UpdateWordbook is not implemented for builtin wordbooks
func (s *WordbookServiceServer) UpdateWordbook(ctx context.Context, req *connect.Request[wordbookv1.UpdateWordbookRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	return nil, status.Error(codes.Unimplemented, "updating wordbooks is not yet supported")
}

// DeleteWordbook is not implemented for builtin wordbooks
func (s *WordbookServiceServer) DeleteWordbook(ctx context.Context, req *connect.Request[commonv1.IDRequest]) (*connect.Response[emptypb.Empty], error) {
	return nil, status.Error(codes.Unimplemented, "deleting wordbooks is not yet supported")
}

// AddWords is not implemented for builtin wordbooks
func (s *WordbookServiceServer) AddWords(ctx context.Context, req *connect.Request[wordbookv1.WordsActionRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	return nil, status.Error(codes.Unimplemented, "adding words to wordbooks is not yet supported")
}

// RemoveWords is not implemented for builtin wordbooks
func (s *WordbookServiceServer) RemoveWords(ctx context.Context, req *connect.Request[wordbookv1.WordsActionRequest]) (*connect.Response[wordbookv1.Wordbook], error) {
	return nil, status.Error(codes.Unimplemented, "removing words from wordbooks is not yet supported")
}

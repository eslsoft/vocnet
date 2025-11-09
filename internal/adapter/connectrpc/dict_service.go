package grpc

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

var _ dictv1connect.DictServiceHandler = (*DictServiceServer)(nil)

type DictServiceServer struct {
	dictv1connect.UnimplementedDictServiceHandler
	wordUC usecase.WordUsecase
}

func NewDictServiceServer(wordUC usecase.WordUsecase) *DictServiceServer {
	return &DictServiceServer{
		wordUC: wordUC,
	}
}

func (s *DictServiceServer) CreateWord(ctx context.Context, req *connect.Request[dictv1.CreateWordRequest]) (*connect.Response[dictv1.Word], error) {
	return nil, status.Error(codes.Unimplemented, "CreateWord not supported")
}

func (s *DictServiceServer) UpdateWord(ctx context.Context, req *connect.Request[dictv1.Word]) (*connect.Response[dictv1.Word], error) {
	return nil, status.Error(codes.Unimplemented, "UpdateWord not supported")
}

func (s *DictServiceServer) GetWord(ctx context.Context, req *connect.Request[dictv1.WordIDRequest]) (*connect.Response[dictv1.Word], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "word id required")
	}
	word, err := s.wordUC.Get(ctx, req.Msg.GetWordId())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}
	return connect.NewResponse(mapping.ToPbWord(word)), nil
}

func (s *DictServiceServer) ListWords(ctx context.Context, req *connect.Request[dictv1.ListWordsRequest]) (*connect.Response[dictv1.ListWordsResponse], error) {
	filter := &repository.ListWordGroupQuery{
		Pagination: repository.Pagination{PageNo: 1, PageSize: 20},
	}
	words, _, err := s.wordUC.List(ctx, filter)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	resp := &dictv1.ListWordsResponse{}
	for _, word := range words {
		resp.Words = append(resp.Words, mapping.ToPbWord(word))
	}

	return connect.NewResponse(resp), nil
}

func (s *DictServiceServer) LookupWord(ctx context.Context, req *connect.Request[dictv1.LookupWordRequest]) (*connect.Response[dictv1.Word], error) {
	if req.Msg == nil || strings.TrimSpace(req.Msg.GetWord()) == "" {
		return nil, status.Error(codes.InvalidArgument, "word text required")
	}
	word, err := s.wordUC.Lookup(ctx, req.Msg.GetWord(), entity.LanguageEnglish)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}
	return connect.NewResponse(mapping.ToPbWord(word)), nil
}

func (s *DictServiceServer) DeleteWord(ctx context.Context, req *connect.Request[dictv1.WordIDRequest]) (*connect.Response[emptypb.Empty], error) {
	return nil, status.Error(codes.Unimplemented, "DeleteWord not supported")
}

package grpc

import (
	"context"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
	"github.com/eslsoft/vocnet/pkg/api/learning/v1/learningv1connect"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

var _ learningv1connect.LearningServiceHandler = (*LearningServiceServer)(nil)

type LearningServiceServer struct {
	learningv1connect.UnimplementedLearningServiceHandler

	uc usecase.LearnedLexemeUsecase
}

func NewLearningServiceServer(uc usecase.LearnedLexemeUsecase) *LearningServiceServer {
	return &LearningServiceServer{uc: uc}
}

func (s *LearningServiceServer) CollectLexeme(ctx context.Context, req *connect.Request[learningv1.CollectLexemeRequest]) (*connect.Response[learningv1.LearnedLexeme], error) {
	if req.Msg == nil || req.Msg.Lexeme == nil {
		return nil, status.Error(codes.InvalidArgument, "lexeme payload required")
	}

	userID := int64(1000)
	entityLexeme := mapping.FromPbLearnedLexeme(req.Msg.Lexeme)
	result, err := s.uc.CollectLexeme(ctx, userID, entityLexeme)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(mapping.ToPbLearnedLexeme(result)), nil
}

func (s *LearningServiceServer) UncollectLexeme(ctx context.Context, req *connect.Request[learningv1.LearnedLexemeKey]) (*connect.Response[emptypb.Empty], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "lexeme id required")
	}
	userID := int64(1000)
	if err := s.uc.DeleteLearnedLexeme(ctx, userID, req.Msg.GetLexemeId()); err != nil {
		return nil, err
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (s *LearningServiceServer) ListLearnedLexemes(ctx context.Context, req *connect.Request[learningv1.ListLearnedLexemesRequest]) (*connect.Response[learningv1.ListLearnedLexemesResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "request required")
	}
	msg := req.Msg
	query := &repository.ListLearnedLexemeQuery{
		Pagination: convertPagination(msg.GetPagination()),
		FilterOrder: repository.FilterOrder{
			Filter:  msg.GetFilter(),
			OrderBy: msg.GetOrderBy(),
		},
		UserID: int64(1000),
	}
	items, total, err := s.uc.ListLearnedLexemes(ctx, query)
	if err != nil {
		return nil, err
	}

	total32, err := safeInt32("total user lexemes", total)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	resp := &learningv1.ListLearnedLexemesResponse{
		Pagination: &commonv1.PaginationResponse{
			Total:  total32,
			PageNo: query.PageNo,
		},
	}
	for _, item := range items {
		resp.Lexemes = append(resp.Lexemes, mapping.ToPbLearnedLexeme(&item))
	}

	return connect.NewResponse(resp), nil
}

func (s *LearningServiceServer) UpdateMastery(ctx context.Context, req *connect.Request[learningv1.UpdateMasteryRequest]) (*connect.Response[learningv1.LearnedLexeme], error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request required")
	}

	msg := req.Msg
	userID := int64(1000)
	result, err := s.uc.UpdateMastery(
		ctx,
		userID,
		msg.GetLexemeId(),
		mapping.FromPbMastery(msg.GetMastery()),
		mapping.FromPbReview(msg.GetReview()),
		mapping.FromPbFormStatusMap(msg.GetFormStatus()),
		msg.GetNote(),
	)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(mapping.ToPbLearnedLexeme(result)), nil
}

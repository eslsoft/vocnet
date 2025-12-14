package connectrpc

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/auth"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
	"github.com/eslsoft/vocnet/pkg/api/learning/v1/learningv1connect"
	"github.com/eslsoft/vocnet/pkg/filterexpr"
	"github.com/samber/lo"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

var _ learningv1connect.LearningServiceHandler = (*LearningServiceServer)(nil)

type LearningServiceServer struct {
	learningv1connect.UnimplementedLearningServiceHandler

	uc usecase.LearnedWordUsecase
}

func NewLearningServiceServer(uc usecase.LearnedWordUsecase) *LearningServiceServer {
	return &LearningServiceServer{uc: uc}
}

func (s *LearningServiceServer) CollectWord(ctx context.Context, req *connect.Request[learningv1.CollectWordRequest]) (*connect.Response[learningv1.LearnedWord], error) {
	if req.Msg == nil || req.Msg.Spec == nil {
		return nil, status.Error(codes.InvalidArgument, "spec payload required")
	}

	entityWord := &entity.LearnedWord{
		UserID:   auth.MustGetUserID(ctx),
		Term:     strings.TrimSpace(req.Msg.Spec.GetTerm()),
		Mastery:  entity.MasteryBreakdown{Overall: req.Msg.Spec.GetMasteryLevel()},
		Language: mapping.FromPbLanguage(req.Msg.Spec.GetLanguage()),
		Tags:     req.Msg.Spec.GetTags(),
		Notes:    req.Msg.Spec.GetNotes(),
	}
	result, err := s.uc.CollectWord(ctx, entityWord)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(mapping.ToPbLearnedWord(result)), nil
}

func (s *LearningServiceServer) UncollectWord(ctx context.Context, req *connect.Request[commonv1.IDRequest]) (*connect.Response[emptypb.Empty], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "id required")
	}
	if err := s.uc.DeleteLearnedWord(ctx, req.Msg.GetId()); err != nil {
		return nil, err
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (s *LearningServiceServer) GetLearnedWord(ctx context.Context, req *connect.Request[commonv1.IDRequest]) (*connect.Response[learningv1.LearnedWord], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "id required")
	}
	result, err := s.uc.GetLearnedWord(ctx, req.Msg.GetId())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(mapping.ToPbLearnedWord(result)), nil
}

func (s *LearningServiceServer) ListLearnedWords(ctx context.Context, req *connect.Request[learningv1.ListLearnedWordsRequest]) (*connect.Response[learningv1.ListLearnedWordsResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "request required")
	}
	var query repository.ListLearnedWordQuery
	if err := filterexpr.Bind(req.Msg, &query, listLearnedWordsFilterSchema); err != nil {
		return nil, err
	}

	query.UserID = auth.MustGetUserID(ctx)
	query.Pagination = convertPagination(req.Msg.GetPagination())
	items, total, err := s.uc.ListLearnedWords(ctx, &query)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&learningv1.ListLearnedWordsResponse{
		Pagination: &commonv1.PaginationResponse{Total: int32(total), PageNo: query.PageNo}, // nolint:gosec
		Words: lo.Map(items, func(item entity.LearnedWord, index int) *learningv1.LearnedWord {
			return mapping.ToPbLearnedWord(&item)
		}),
	}), nil
}

func (s *LearningServiceServer) UpdateMastery(ctx context.Context, req *connect.Request[learningv1.UpdateMasteryRequest]) (*connect.Response[learningv1.LearnedWord], error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request required")
	}

	msg := req.Msg
	result, err := s.uc.UpdateMastery(
		ctx,
		msg.GetId(),
		mapping.FromPbMastery(msg.GetMastery()),
		entity.ReviewTiming{}, // Review timing not provided in proto
		msg.GetNotes(),
	)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(mapping.ToPbLearnedWord(result)), nil
}

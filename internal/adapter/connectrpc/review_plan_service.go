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
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
	"github.com/eslsoft/vocnet/pkg/api/learning/v1/learningv1connect"
	"github.com/eslsoft/vocnet/pkg/filterexpr"
)

var _ learningv1connect.ReviewPlanServiceHandler = (*ReviewPlanServiceServer)(nil)

type ReviewPlanServiceServer struct {
	learningv1connect.UnimplementedReviewPlanServiceHandler
	uc usecase.ReviewPlanUsecase
}

func NewReviewPlanServiceServer(uc usecase.ReviewPlanUsecase) *ReviewPlanServiceServer {
	return &ReviewPlanServiceServer{uc: uc}
}

func (s *ReviewPlanServiceServer) CreateReviewPlan(ctx context.Context, req *connect.Request[learningv1.CreateReviewPlanRequest]) (*connect.Response[learningv1.ReviewPlan], error) {
	if req.Msg == nil {
		return nil, mapping.ToPbError(entity.ErrInvalidInput)
	}

	entPlan := &entity.ReviewPlan{
		Name:        req.Msg.GetName(),
		Description: req.Msg.GetDescription(),
		WordbookIDs: append([]int64{}, req.Msg.GetWordbookIds()...),
	}

	created, err := s.uc.Create(ctx, entPlan)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbReviewPlan(created)), nil
}

func (s *ReviewPlanServiceServer) UpdateReviewPlan(ctx context.Context, req *connect.Request[learningv1.UpdateReviewPlanRequest]) (*connect.Response[learningv1.ReviewPlan], error) {
	if req.Msg == nil || req.Msg.GetId() == 0 {
		return nil, mapping.ToPbError(entity.ErrInvalidReviewPlanID)
	}

	entPlan := &entity.ReviewPlan{
		ID:          int64(req.Msg.GetId()),
		Name:        req.Msg.GetName(),
		Description: req.Msg.GetDescription(),
		WordbookIDs: append([]int64{}, req.Msg.GetWordbookIds()...),
	}

	updated, err := s.uc.Update(ctx, entPlan)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbReviewPlan(updated)), nil
}

func (s *ReviewPlanServiceServer) GetReviewPlan(ctx context.Context, req *connect.Request[commonv1.IDRequest]) (*connect.Response[learningv1.ReviewPlan], error) {
	if req.Msg == nil || req.Msg.GetId() == 0 {
		return nil, mapping.ToPbError(entity.ErrInvalidReviewPlanID)
	}

	plan, err := s.uc.Get(ctx, req.Msg.GetId())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbReviewPlan(plan)), nil
}

func (s *ReviewPlanServiceServer) ListReviewPlans(ctx context.Context, req *connect.Request[learningv1.ListReviewPlansRequest]) (*connect.Response[learningv1.ListReviewPlansResponse], error) {
	if req.Msg == nil {
		req.Msg = &learningv1.ListReviewPlansRequest{}
	}

	params := repository.ListReviewPlanQuery{
		Pagination: convertPagination(req.Msg.GetPagination()),
	}
	if err := filterexpr.Bind(req.Msg, &params, listReviewPlansSchema); err != nil {
		return nil, err
	}

	items, total, err := s.uc.List(ctx, &params)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	resp := &learningv1.ListReviewPlansResponse{
		Pagination: &commonv1.PaginationResponse{
			Total:  int32(total),
			PageNo: params.PageNo,
		},
		Plans: lo.Map(items, func(item *entity.ReviewPlan, _ int) *learningv1.ReviewPlan {
			return mapping.ToPbReviewPlan(item)
		}),
	}
	return connect.NewResponse(resp), nil
}

func (s *ReviewPlanServiceServer) DeleteReviewPlan(ctx context.Context, req *connect.Request[commonv1.IDRequest]) (*connect.Response[emptypb.Empty], error) {
	if req.Msg == nil || req.Msg.GetId() == 0 {
		return nil, mapping.ToPbError(entity.ErrInvalidReviewPlanID)
	}

	if err := s.uc.Delete(ctx, req.Msg.GetId()); err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (s *ReviewPlanServiceServer) GetFlashCards(ctx context.Context, req *connect.Request[learningv1.GetFlashCardsRequest]) (*connect.Response[learningv1.FlashCardSet], error) {
	if req.Msg == nil {
		return nil, mapping.ToPbError(entity.ErrInvalidInput)
	}

	planID := req.Msg.GetReviewPlanId()
	if planID <= 0 {
		return nil, mapping.ToPbError(entity.ErrInvalidReviewPlanID)
	}

	limit := req.Msg.GetLimit()
	if limit <= 0 {
		limit = 20 // Default limit
	}
	if limit > 100 {
		limit = 100 // Max limit
	}

	// Call usecase
	cardSet, err := s.uc.GetFlashCards(ctx, int64(planID), limit)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	// Convert to proto
	resp := mapping.ToPbFlashCardSet(cardSet)

	return connect.NewResponse(resp), nil
}

func (s *ReviewPlanServiceServer) SubmitAnswer(ctx context.Context, req *connect.Request[learningv1.SubmitAnswerRequest]) (*connect.Response[emptypb.Empty], error) {
	if req.Msg == nil {
		return nil, mapping.ToPbError(entity.ErrInvalidInput)
	}

	planID := req.Msg.GetReviewPlanId()
	if planID <= 0 {
		return nil, mapping.ToPbError(entity.ErrInvalidReviewPlanID)
	}

	if len(req.Msg.GetResults()) == 0 {
		return nil, mapping.ToPbError(entity.ErrInvalidInput)
	}

	// Convert proto to usecase types
	results := mapping.FromPbAnswerResults(req.Msg.GetResults())

	// Call usecase
	err := s.uc.SubmitAnswer(ctx, int64(planID), results)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

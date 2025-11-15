package connectrpc

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
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
	if req.Msg == nil || req.Msg.GetWord() == nil {
		return nil, status.Error(codes.InvalidArgument, "word required")
	}

	// Convert proto to entity
	entityLemma := mapping.ToEntityLemma(req.Msg.GetWord())
	if entityLemma == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid word")
	}

	created, err := s.wordUC.CreateLemma(ctx, entityLemma)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	entry := &entity.WordEntry{
		QueriedTerm:     created.Text,
		Lemma:           created,
		QueriedFormType: entity.LexemeFormTypeLemma,
	}
	return connect.NewResponse(mapping.ToPbWord(entry)), nil
}

func (s *DictServiceServer) UpdateWord(ctx context.Context, req *connect.Request[dictv1.Word]) (*connect.Response[dictv1.Word], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "word required")
	}
	if req.Msg.GetId() == 0 {
		return nil, status.Error(codes.InvalidArgument, "word id required")
	}

	// Convert proto to entity
	entityLemma := mapping.ToEntityLemma(req.Msg)
	if entityLemma == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid word")
	}

	// Update word via usecase
	updated, err := s.wordUC.UpdateLemma(ctx, entityLemma)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	entry := &entity.WordEntry{
		QueriedTerm:     updated.Text,
		Lemma:           updated,
		QueriedFormType: entity.LexemeFormTypeLemma,
	}
	return connect.NewResponse(mapping.ToPbWord(entry)), nil
}

func (s *DictServiceServer) GetWord(ctx context.Context, req *connect.Request[dictv1.WordIDRequest]) (*connect.Response[dictv1.Word], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "word id required")
	}
	lemma, err := s.wordUC.GetLemma(ctx, req.Msg.GetWordId())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}
	entry := &entity.WordEntry{
		QueriedTerm:     lemma.Text,
		Lemma:           lemma,
		QueriedFormType: entity.LexemeFormTypeLemma,
	}
	return connect.NewResponse(mapping.ToPbWord(entry)), nil
}

func (s *DictServiceServer) ListWords(ctx context.Context, req *connect.Request[dictv1.ListWordsRequest]) (*connect.Response[dictv1.ListWordsResponse], error) {
	filter := &repository.ListLemmaQuery{
		Pagination: repository.Pagination{
			PageNo:   1,
			PageSize: 20,
		},
		FilterOrder: repository.FilterOrder{
			Filter:  req.Msg.GetFilter(),
			OrderBy: req.Msg.GetOrderBy(),
		},
	}

	// Apply pagination
	if req.Msg.GetPagination() != nil {
		if req.Msg.GetPagination().GetPageNo() > 0 {
			filter.PageNo = req.Msg.GetPagination().GetPageNo()
		}
		if req.Msg.GetPagination().GetPageSize() > 0 {
			filter.PageSize = req.Msg.GetPagination().GetPageSize()
		}
		// Limit max page size to 100000
		if filter.PageSize > 10000 {
			filter.PageSize = 10000
		}
	}

	entries, total, err := s.wordUC.List(ctx, filter)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	// Safe conversion of total to int32
	var totalCount int32
	if total > 0x7FFFFFFF {
		totalCount = 0x7FFFFFFF // max int32
	} else {
		totalCount = int32(total) //nolint:gosec // checked above
	}

	resp := &dictv1.ListWordsResponse{
		Pagination: &commonv1.PaginationResponse{
			Total:  totalCount,
			PageNo: filter.PageNo,
		},
	}
	for _, entry := range entries {
		resp.Words = append(resp.Words, mapping.ToPbWord(entry))
	}

	return connect.NewResponse(resp), nil
}

func (s *DictServiceServer) LookupWord(ctx context.Context, req *connect.Request[dictv1.LookupWordRequest]) (*connect.Response[dictv1.Word], error) {
	if req.Msg == nil || strings.TrimSpace(req.Msg.GetWord()) == "" {
		return nil, status.Error(codes.InvalidArgument, "word text required")
	}
	entry, err := s.wordUC.Lookup(ctx, req.Msg.GetWord(), entity.LanguageEnglish)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}
	return connect.NewResponse(mapping.ToPbWord(entry)), nil
}

func (s *DictServiceServer) DeleteWord(ctx context.Context, req *connect.Request[dictv1.WordIDRequest]) (*connect.Response[emptypb.Empty], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "word id required")
	}
	if req.Msg.GetWordId() == 0 {
		return nil, status.Error(codes.InvalidArgument, "word id required")
	}

	// Delete word via usecase
	err := s.wordUC.DeleteLemma(ctx, req.Msg.GetWordId())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (s *DictServiceServer) GetWordStats(ctx context.Context, req *connect.Request[dictv1.GetWordStatsRequest]) (*connect.Response[dictv1.GetWordStatsResponse], error) {
	var filter *entity.WordStatsFilter
	if req != nil {
		filter = mapping.ToEntityWordStatsFilter(req.Msg)
	}
	stats, err := s.wordUC.Stats(ctx, filter)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}
	return connect.NewResponse(mapping.ToPbWordStats(stats)), nil
}

func (s *DictServiceServer) ListCategories(ctx context.Context, req *connect.Request[dictv1.ListCategoriesRequest]) (*connect.Response[dictv1.ListCategoriesResponse], error) {
	search := ""
	if req.Msg != nil {
		search = strings.TrimSpace(req.Msg.GetSearch())
	}

	categories, err := s.wordUC.ListCategories(ctx, search)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	resp := &dictv1.ListCategoriesResponse{
		Categories: categories,
	}
	return connect.NewResponse(resp), nil
}

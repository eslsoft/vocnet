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

var _ pipelinev1connect.PipelineServiceHandler = (*PipelineServiceServer)(nil)

type PipelineServiceServer struct {
	pipelinev1connect.UnimplementedPipelineServiceHandler
	pipelineUC *pipelineuc.PipelineService
}

func NewPipelineServiceServer(pipelineUC *pipelineuc.PipelineService) *PipelineServiceServer {
	return &PipelineServiceServer{pipelineUC: pipelineUC}
}

func (s *PipelineServiceServer) SubmitJob(ctx context.Context, req *connect.Request[pipelinev1.SubmitJobRequest]) (*connect.Response[pipelinev1.SubmitJobResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}

	job, err := s.pipelineUC.SubmitJob(ctx, req.Msg.GetTerm(), req.Msg.GetLanguage(), req.Msg.GetTier(), req.Msg.GetName())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&pipelinev1.SubmitJobResponse{Job: toPBPipelineJob(job)}), nil
}

func (s *PipelineServiceServer) ActionJob(ctx context.Context, req *connect.Request[pipelinev1.ActionJobRequest]) (*connect.Response[pipelinev1.ActionJobResponse], error) {
	if req == nil || req.Msg == nil || req.Msg.GetJobId() == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}

	switch req.Msg.GetAction() {
	case pipelinev1.PipelineActionType_PIPELINE_ACTION_TYPE_CANCEL:
		if err := s.pipelineUC.CancelJob(ctx, req.Msg.GetJobId()); err != nil {
			return nil, mapping.ToPbError(err)
		}
		job, err := s.pipelineUC.GetJob(ctx, req.Msg.GetJobId())
		if err != nil {
			return nil, mapping.ToPbError(err)
		}
		return connect.NewResponse(&pipelinev1.ActionJobResponse{Job: toPBPipelineJob(job)}), nil

	case pipelinev1.PipelineActionType_PIPELINE_ACTION_TYPE_RETRY:
		newJob, err := s.pipelineUC.RetryAsNewJob(ctx, req.Msg.GetJobId())
		if err != nil {
			return nil, mapping.ToPbError(err)
		}
		oldJob, err := s.pipelineUC.GetJob(ctx, req.Msg.GetJobId())
		if err != nil {
			return nil, mapping.ToPbError(err)
		}
		return connect.NewResponse(&pipelinev1.ActionJobResponse{
			Job:    toPBPipelineJob(oldJob),
			NewJob: toPBPipelineJob(newJob),
		}), nil
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}
}

func (s *PipelineServiceServer) ListJobs(ctx context.Context, req *connect.Request[pipelinev1.ListJobsRequest]) (*connect.Response[pipelinev1.ListJobsResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}

	pagination := convertPagination(req.Msg.GetPagination())
	jobs, total, err := s.pipelineUC.ListJobsFiltered(ctx, &pipelineuc.ListJobsQuery{
		PageNo:   pagination.PageNo,
		PageSize: pagination.PageSize,
		Status:   toEntityJobStatusPtr(req.Msg.GetStatus()),
		LemmaID:  req.Msg.GetLemmaId(),
	})
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	resp := &pipelinev1.ListJobsResponse{
		Pagination: &commonv1.PaginationResponse{Total: int32(total), PageNo: pagination.PageNo}, // nolint:gosec
		Jobs:       make([]*pipelinev1.PipelineJob, 0, len(jobs)),
	}
	for _, job := range jobs {
		resp.Jobs = append(resp.Jobs, toPBPipelineJob(job))
	}

	return connect.NewResponse(resp), nil
}

func (s *PipelineServiceServer) ListJobStages(ctx context.Context, req *connect.Request[pipelinev1.ListJobStagesRequest]) (*connect.Response[pipelinev1.ListJobStagesResponse], error) {
	if req == nil || req.Msg == nil || req.Msg.GetJobId() == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}

	stages, err := s.pipelineUC.ListJobStages(ctx, req.Msg.GetJobId())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	resp := &pipelinev1.ListJobStagesResponse{Stages: make([]*pipelinev1.PipelineDropStage, 0, len(stages))}
	for _, st := range stages {
		resp.Stages = append(resp.Stages, toPBPipelineStage(st))
	}

	return connect.NewResponse(resp), nil
}

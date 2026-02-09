package connectrpc

import (
	"context"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/entity"
	pipelineuc "github.com/eslsoft/vocnet/internal/usecase/pipeline"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	pipelinev1 "github.com/eslsoft/vocnet/pkg/api/pipeline/v1"
	"github.com/eslsoft/vocnet/pkg/api/pipeline/v1/pipelinev1connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var _ pipelinev1connect.PipelineServiceHandler = (*PipelineServiceServer)(nil)

type PipelineServiceServer struct {
	pipelinev1connect.UnimplementedPipelineServiceHandler
	pipelineUC *pipelineuc.PipelineService
}

func NewPipelineServiceServer(pipelineUC *pipelineuc.PipelineService) *PipelineServiceServer {
	return &PipelineServiceServer{pipelineUC: pipelineUC}
}

func (s *PipelineServiceServer) ListJobs(ctx context.Context, req *connect.Request[pipelinev1.ListJobsRequest]) (*connect.Response[pipelinev1.ListJobsResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}

	var status *entity.JobStatus
	if raw := strings.TrimSpace(req.Msg.GetStatus()); raw != "" {
		s := entity.JobStatus(strings.ToUpper(raw))
		switch s {
		case entity.JobStatusPending,
			entity.JobStatusRunning,
			entity.JobStatusPaused,
			entity.JobStatusCompleted,
			entity.JobStatusFailed,
			entity.JobStatusCancelled:
			status = &s
		default:
			return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
		}
	}

	pagination := convertPagination(req.Msg.GetPagination())
	jobs, total, err := s.pipelineUC.ListJobsFiltered(ctx, &pipelineuc.ListJobsQuery{
		PageNo:   pagination.PageNo,
		PageSize: pagination.PageSize,
		Status:   status,
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

	resp := &pipelinev1.ListJobStagesResponse{Stages: make([]*pipelinev1.PipelineStage, 0, len(stages))}
	for _, st := range stages {
		resp.Stages = append(resp.Stages, toPBPipelineStage(st))
	}

	return connect.NewResponse(resp), nil
}

func (s *PipelineServiceServer) ListLemmas(ctx context.Context, req *connect.Request[pipelinev1.ListLemmasRequest]) (*connect.Response[pipelinev1.ListLemmasResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, entity.ErrInvalidInput)
	}

	pagination := convertPagination(req.Msg.GetPagination())
	lemmas, total, err := s.pipelineUC.ListLemmas(ctx, &pipelineuc.ListLemmasQuery{
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

func toPBPipelineJob(job *entity.PipelineJob) *pipelinev1.PipelineJob {
	if job == nil {
		return nil
	}
	return &pipelinev1.PipelineJob{
		Id:           job.ID,
		JobType:      string(job.JobType),
		Status:       string(job.Status),
		Name:         job.Name,
		Language:     job.Language,
		Tier:         job.Tier,
		Term:         job.Term,
		TotalTerms:   job.TotalTerms,
		Processed:    job.Processed,
		Skipped:      job.Skipped,
		Failed:       job.Failed,
		ErrorMessage: job.ErrorMessage,
		StartedAt:    toPBTimestamp(job.StartedAt),
		CompletedAt:  toPBTimestamp(job.CompletedAt),
		CreatedAt:    timestamppb.New(job.CreatedAt),
		UpdatedAt:    timestamppb.New(job.UpdatedAt),
	}
}

func toPBPipelineStage(stage *entity.PipelineTask) *pipelinev1.PipelineStage {
	if stage == nil {
		return nil
	}
	phase := entity.PipelinePhase(stage.Phase)
	return &pipelinev1.PipelineStage{
		Id:           stage.ID,
		JobId:        stage.JobID,
		LemmaId:      stage.LemmaID,
		Phase:        stage.Phase,
		PhaseName:    phase.Name(),
		Status:       string(stage.Status),
		Attempts:     stage.Attempts,
		ErrorMessage: stage.ErrorMessage,
		StartedAt:    toPBTimestamp(stage.StartedAt),
		CompletedAt:  toPBTimestamp(stage.CompletedAt),
		CreatedAt:    timestamppb.New(stage.CreatedAt),
		UpdatedAt:    timestamppb.New(stage.UpdatedAt),
	}
}

func toPBLemmaItem(lemma *entity.Lemma) *pipelinev1.LemmaItem {
	if lemma == nil {
		return nil
	}
	return &pipelinev1.LemmaItem{
		Id:         lemma.ID,
		Surface:    lemma.Surface,
		Normalized: lemma.Normalized,
		Level:      lemma.Level,
		CreatedAt:  timestamppb.New(lemma.CreatedAt),
		UpdatedAt:  timestamppb.New(lemma.UpdatedAt),
	}
}

func toPBTimestamp(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(*t)
}

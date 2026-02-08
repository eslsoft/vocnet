package connectrpc

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"github.com/samber/lo"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	pipelinev1 "github.com/eslsoft/vocnet/pkg/api/pipeline/v1"
	"github.com/eslsoft/vocnet/pkg/api/pipeline/v1/pipelinev1connect"
	"github.com/eslsoft/vocnet/pkg/wordbook"
)

var _ pipelinev1connect.PipelineServiceHandler = (*PipelineServiceServer)(nil)

// PipelineServiceServer implements the PipelineService ConnectRPC handler.
type PipelineServiceServer struct {
	pipelinev1connect.UnimplementedPipelineServiceHandler

	svc *pipeline.PipelineService
}

// NewPipelineServiceServer creates a new PipelineServiceServer.
func NewPipelineServiceServer(svc *pipeline.PipelineService) *PipelineServiceServer {
	return &PipelineServiceServer{svc: svc}
}

// ---------------------------------------------------------------------------
// Word-level pipeline RPCs
// ---------------------------------------------------------------------------

func (s *PipelineServiceServer) ProcessWord(_ context.Context, _ *connect.Request[pipelinev1.ProcessWordRequest]) (*connect.Response[pipelinev1.ProcessWordResponse], error) {
	// ProcessWord is a synchronous pipeline execution. This requires the full Pipeline
	// orchestrator (not just PipelineService). For now, return unimplemented.
	// In the future, this could be wired to Pipeline.Run() directly.
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("ProcessWord requires the full pipeline orchestrator"))
}

func (s *PipelineServiceServer) GetPipelineStatus(ctx context.Context, req *connect.Request[pipelinev1.GetPipelineStatusRequest]) (*connect.Response[pipelinev1.PipelineStatus], error) {
	if req.Msg == nil || strings.TrimSpace(req.Msg.GetTerm()) == "" {
		return nil, status.Error(codes.InvalidArgument, "term is required")
	}

	lemma, tasks, err := s.svc.GetPipelineStatus(ctx, req.Msg.GetTerm(), req.Msg.GetLanguage())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbPipelineStatus(lemma, tasks)), nil
}

func (s *PipelineServiceServer) RetryPhase(_ context.Context, _ *connect.Request[pipelinev1.RetryPhaseRequest]) (*connect.Response[pipelinev1.PipelineStatus], error) {
	// RetryPhase requires the full Pipeline orchestrator. Return unimplemented for now.
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("RetryPhase requires the full pipeline orchestrator"))
}

// ---------------------------------------------------------------------------
// Snapshot RPCs
// ---------------------------------------------------------------------------

func (s *PipelineServiceServer) GetWordSnapshot(ctx context.Context, req *connect.Request[pipelinev1.GetWordSnapshotRequest]) (*connect.Response[pipelinev1.WordSnapshotResponse], error) {
	if req.Msg == nil || strings.TrimSpace(req.Msg.GetTerm()) == "" {
		return nil, status.Error(codes.InvalidArgument, "term is required")
	}

	snapshot, err := s.svc.GetWordSnapshot(ctx, req.Msg.GetTerm(), req.Msg.GetLanguage())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbWordSnapshot(snapshot)), nil
}

func (s *PipelineServiceServer) ListWordSnapshots(ctx context.Context, req *connect.Request[pipelinev1.ListWordSnapshotsRequest]) (*connect.Response[pipelinev1.ListWordSnapshotsResponse], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "request required")
	}

	query := &repository.ListSnapshotsQuery{
		Language:  req.Msg.GetLanguage(),
		MinQScore: req.Msg.GetMinQscore(),
		OrderBy:   req.Msg.GetOrderBy(),
		Desc:      req.Msg.GetDesc(),
		PageSize:  req.Msg.GetPageSize(),
		PageNo:    req.Msg.GetPageNo(),
	}

	snapshots, total, err := s.svc.ListWordSnapshots(ctx, query)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&pipelinev1.ListWordSnapshotsResponse{
		Snapshots: lo.Map(snapshots, func(snap *entity.WordSnapshot, _ int) *pipelinev1.WordSnapshotResponse {
			return mapping.ToPbWordSnapshot(snap)
		}),
		Total:  int32(total),
		PageNo: query.PageNo,
	}), nil
}

// ---------------------------------------------------------------------------
// Evidence RPCs
// ---------------------------------------------------------------------------

func (s *PipelineServiceServer) GetEvidence(ctx context.Context, req *connect.Request[pipelinev1.GetEvidenceRequest]) (*connect.Response[pipelinev1.GetEvidenceResponse], error) {
	if req.Msg == nil || strings.TrimSpace(req.Msg.GetTerm()) == "" {
		return nil, status.Error(codes.InvalidArgument, "term is required")
	}

	evidences, err := s.svc.GetEvidence(ctx, req.Msg.GetTerm(), req.Msg.GetLanguage(), req.Msg.GetPhase(), req.Msg.GetProvider())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&pipelinev1.GetEvidenceResponse{
		Evidences: lo.Map(evidences, func(e *entity.RawEvidence, _ int) *pipelinev1.Evidence {
			return mapping.ToPbEvidence(e)
		}),
	}), nil
}

// ---------------------------------------------------------------------------
// Job management RPCs
// ---------------------------------------------------------------------------

func (s *PipelineServiceServer) SubmitJob(ctx context.Context, req *connect.Request[pipelinev1.SubmitJobRequest]) (*connect.Response[pipelinev1.PipelineJob], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "request required")
	}

	msg := req.Msg
	term := strings.TrimSpace(msg.GetTerm())
	terms := msg.GetTerms()
	wbName := strings.TrimSpace(msg.GetWordbookName())
	language := msg.GetLanguage()
	tier := msg.GetTier()
	name := msg.GetName()

	var job *entity.PipelineJob
	var err error

	switch {
	case wbName != "":
		// Resolve wordbook to terms
		resolvedTerms, resolvedName, resolveErr := resolveWordbook(wbName)
		if resolveErr != nil {
			return nil, connect.NewError(connect.CodeNotFound, resolveErr)
		}
		if name == "" {
			name = resolvedName
		}
		job, err = s.svc.SubmitTerms(ctx, name, resolvedTerms, language, tier)
	case len(terms) > 0:
		job, err = s.svc.SubmitTerms(ctx, name, terms, language, tier)
	case term != "":
		job, err = s.svc.SubmitWord(ctx, term, language, tier)
	default:
		return nil, status.Error(codes.InvalidArgument, "one of term, terms, or wordbook_name is required")
	}

	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbPipelineJob(job)), nil
}

//nolint:dupl // GetJob and CancelJob are distinct RPCs with identical structure
func (s *PipelineServiceServer) GetJob(ctx context.Context, req *connect.Request[pipelinev1.GetJobRequest]) (*connect.Response[pipelinev1.PipelineJob], error) {
	if req.Msg == nil || req.Msg.GetId() == 0 {
		return nil, status.Error(codes.InvalidArgument, "job id is required")
	}

	job, err := s.svc.GetJob(ctx, req.Msg.GetId())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbPipelineJob(job)), nil
}

func (s *PipelineServiceServer) ListJobs(ctx context.Context, req *connect.Request[pipelinev1.ListJobsRequest]) (*connect.Response[pipelinev1.ListJobsResponse], error) {
	if req.Msg == nil {
		return nil, status.Error(codes.InvalidArgument, "request required")
	}

	var statusFilter *entity.JobStatus
	if s := strings.TrimSpace(req.Msg.GetStatus()); s != "" {
		js := entity.JobStatus(strings.ToUpper(s))
		statusFilter = &js
	}

	limit := int(req.Msg.GetLimit())
	jobs, err := s.svc.ListJobs(ctx, statusFilter, limit)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&pipelinev1.ListJobsResponse{
		Jobs: lo.Map(jobs, func(j *entity.PipelineJob, _ int) *pipelinev1.PipelineJob {
			return mapping.ToPbPipelineJob(j)
		}),
	}), nil
}

//nolint:dupl // CancelJob and GetJob are distinct RPCs with identical structure
func (s *PipelineServiceServer) CancelJob(ctx context.Context, req *connect.Request[pipelinev1.CancelJobRequest]) (*connect.Response[pipelinev1.PipelineJob], error) {
	if req.Msg == nil || req.Msg.GetId() == 0 {
		return nil, status.Error(codes.InvalidArgument, "job id is required")
	}

	job, err := s.svc.CancelJob(ctx, req.Msg.GetId())
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbPipelineJob(job)), nil
}

// ---------------------------------------------------------------------------
// Data source management RPCs
// ---------------------------------------------------------------------------

func (s *PipelineServiceServer) ListDataSources(ctx context.Context, _ *connect.Request[pipelinev1.ListDataSourcesRequest]) (*connect.Response[pipelinev1.ListDataSourcesResponse], error) {
	statuses, err := s.svc.ListDataSources(ctx)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&pipelinev1.ListDataSourcesResponse{
		Sources: lo.Map(statuses, func(st datasource.Status, _ int) *pipelinev1.DataSourceStatus {
			return mapping.ToPbDataSourceStatus(st)
		}),
	}), nil
}

func (s *PipelineServiceServer) DownloadDataSource(ctx context.Context, req *connect.Request[pipelinev1.DownloadDataSourceRequest]) (*connect.Response[pipelinev1.DownloadDataSourceResponse], error) {
	name := ""
	if req.Msg != nil {
		name = strings.TrimSpace(req.Msg.GetName())
	}

	statuses, err := s.svc.DownloadDataSource(ctx, name)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(&pipelinev1.DownloadDataSourceResponse{
		Sources: lo.Map(statuses, func(st datasource.Status, _ int) *pipelinev1.DataSourceStatus {
			return mapping.ToPbDataSourceStatus(st)
		}),
	}), nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// resolveWordbook finds a builtin wordbook by name or ID and returns its terms.
func resolveWordbook(nameOrID string) ([]string, string, error) {
	builtins := wordbook.GetBuiltinWordbooks()

	// Try by numeric ID
	if id, err := strconv.ParseInt(nameOrID, 10, 64); err == nil {
		for _, wb := range builtins {
			if wb.Id == id {
				return wb.Terms, wb.Name, nil
			}
		}
		return nil, "", fmt.Errorf("wordbook with ID %d not found", id)
	}

	// Try by name (case-insensitive)
	for _, wb := range builtins {
		if strings.EqualFold(wb.Name, nameOrID) {
			return wb.Terms, wb.Name, nil
		}
	}

	return nil, "", fmt.Errorf("wordbook %q not found", nameOrID)
}

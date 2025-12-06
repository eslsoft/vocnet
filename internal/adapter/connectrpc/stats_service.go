package connectrpc

import (
	"context"
	"time"

	"connectrpc.com/connect"

	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/usecase"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
	"github.com/eslsoft/vocnet/pkg/api/learning/v1/learningv1connect"
)

var _ learningv1connect.StatsServiceHandler = (*StatsServiceServer)(nil)

// StatsServiceServer implements the StatsService RPC interface.
type StatsServiceServer struct {
	learningv1connect.UnimplementedStatsServiceHandler
	uc usecase.StatsUsecase
}

// NewStatsServiceServer constructs a new stats service server.
func NewStatsServiceServer(uc usecase.StatsUsecase) *StatsServiceServer {
	return &StatsServiceServer{uc: uc}
}

// GetDashboardStats retrieves comprehensive dashboard metrics.
func (s *StatsServiceServer) GetDashboardStats(ctx context.Context, req *connect.Request[learningv1.GetDashboardStatsRequest]) (*connect.Response[learningv1.DashboardStats], error) {
	stats, err := s.uc.GetDashboardStats(ctx)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbDashboardStats(stats)), nil
}

// GetMasteryDistribution retrieves vocabulary distribution by mastery level.
func (s *StatsServiceServer) GetMasteryDistribution(ctx context.Context, req *connect.Request[learningv1.GetMasteryDistributionRequest]) (*connect.Response[learningv1.MasteryDistribution], error) {
	data, err := s.uc.GetMasteryDistribution(ctx)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbMasteryDistribution(data)), nil
}

// GetActivityCalendar retrieves GitHub-style activity heatmap data.
func (s *StatsServiceServer) GetActivityCalendar(ctx context.Context, req *connect.Request[learningv1.GetActivityCalendarRequest]) (*connect.Response[learningv1.ActivityCalendar], error) {
	var startTime, endTime time.Time
	if req.Msg.GetStartTime() != nil {
		startTime = req.Msg.GetStartTime().AsTime()
	}
	if req.Msg.GetEndTime() != nil {
		endTime = req.Msg.GetEndTime().AsTime()
	}

	timezoneOffset := req.Msg.GetTimezoneOffset()

	data, err := s.uc.GetActivityCalendar(ctx, startTime, endTime, timezoneOffset)
	if err != nil {
		return nil, mapping.ToPbError(err)
	}

	return connect.NewResponse(mapping.ToPbActivityCalendar(data)), nil
}

package server

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	connectcors "connectrpc.com/cors"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/grpc"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
	"github.com/eslsoft/vocnet/pkg/api/learning/v1/learningv1connect"
	"github.com/eslsoft/vocnet/pkg/api/wordbook/v1/wordbookv1connect"
)

// Server represents the application server
type Server struct {
	config     *config.Config
	grpcServer *grpc.Server
	httpServer *http.Server
	logger     *slog.Logger
}

// NewServer creates a new server instance from pre-wired dependencies.
func NewServer(cfg *config.Config, logger *slog.Logger, dictSvc dictv1connect.DictServiceHandler, learningSvc learningv1connect.LearningServiceHandler, wordbookSvc wordbookv1connect.WordbookServiceHandler) (*Server, error) {
	// Create access logger interceptor with file support
	accessLoggerInterceptor, err := LoggerWithConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("create access logger: %w", err)
	}

	interceptors := connect.WithInterceptors(accessLoggerInterceptor)

	mux := http.NewServeMux()
	mux.Handle(dictv1connect.NewDictServiceHandler(dictSvc, interceptors))
	mux.Handle(learningv1connect.NewLearningServiceHandler(learningSvc, interceptors))
	mux.Handle(wordbookv1connect.NewWordbookServiceHandler(wordbookSvc, interceptors))

	return &Server{
		config: cfg,
		httpServer: &http.Server{
			Addr:              fmt.Sprintf(":%d", cfg.Server.HTTPPort),
			Handler:           h2c.NewHandler(withCORS(mux), &http2.Server{}),
			ReadHeaderTimeout: 5 * time.Second,
		},
		logger: logger,
	}, nil
}

// StartGRPC starts the gRPC server
func (s *Server) StartGRPC() error {
	addr := fmt.Sprintf(":%d", s.config.Server.GRPCPort)
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}

	s.logger.Info("gRPC server starting", "address", addr)

	if err := s.grpcServer.Serve(lis); err != nil {
		return fmt.Errorf("failed to serve gRPC: %w", err)
	}

	return nil
}

// StartHTTP starts the HTTP gateway server
func (s *Server) StartHTTP() error {
	// Register gRPC-Gateway handlers

	s.logger.Info("HTTP server starting", "address", s.httpServer.Addr)

	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("failed to serve HTTP: %w", err)
	}

	return nil
}

// Shutdown gracefully shuts down the server
func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("shutting down server")

	// Shutdown HTTP server
	if err := s.httpServer.Shutdown(ctx); err != nil {
		s.logger.Error("failed to shutdown HTTP server", "error", err)
	}

	s.logger.Info("server shutdown complete")
	return nil
}

func withCORS(h http.Handler) http.Handler {
	middleware := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: connectcors.AllowedMethods(),
		AllowedHeaders: connectcors.AllowedHeaders(),
		ExposedHeaders: connectcors.ExposedHeaders(),
	})
	return middleware.Handler(h)
}

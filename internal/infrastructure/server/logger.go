package server

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// NewAccessLogger creates a slog logger for access logs with file output support
func NewAccessLogger(cfg *config.Config) (*slog.Logger, error) {
	handler, err := newHandler(cfg, slog.LevelDebug)
	if err != nil {
		return nil, err
	}
	return slog.New(handler), nil
}

// LoggerWithConfig creates a logger interceptor with configuration support
func LoggerWithConfig(cfg *config.Config) (connect.UnaryInterceptorFunc, error) {
	logger, err := NewAccessLogger(cfg)
	if err != nil {
		return nil, err
	}

	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			start := time.Now()
			resp, err := next(ctx, req)

			duration := time.Since(start)
			code := connect.CodeOf(err)
			level := determineLogLevel(code, err)
			attrs := buildLogAttributes(req, resp, code, duration, err)

			logger.LogAttrs(ctx, level, "request completed", attrs...)

			return resp, err
		}
	}, nil
}

func determineLogLevel(code connect.Code, err error) slog.Level {
	if err == nil {
		return slog.LevelInfo
	}
	switch code {
	case connect.CodeInvalidArgument, connect.CodeFailedPrecondition, connect.CodeNotFound,
		connect.CodeAlreadyExists, connect.CodePermissionDenied, connect.CodeUnauthenticated:
		return slog.LevelWarn
	default:
		return slog.LevelError
	}
}

func buildLogAttributes(req connect.AnyRequest, resp connect.AnyResponse, code connect.Code, duration time.Duration, err error) []slog.Attr {
	attrs := requestAttributes(req, code, duration)
	attrs = append(attrs, responseAttributes(resp)...)

	// Add request body
	if reqBody := serializeMessage(req.Any()); reqBody != "" {
		attrs = append(attrs, slog.String("request_body", reqBody))
	}

	// Add response body
	// if resp != nil {
	// 	if respBody := serializeMessage(resp.Any()); respBody != "" {
	// 		attrs = append(attrs, slog.String("response_body", respBody))
	// 	}
	// }

	if err != nil {
		attrs = append(attrs, slog.String("error", err.Error()))
	}
	return attrs
}

func requestAttributes(req connect.AnyRequest, code connect.Code, duration time.Duration) []slog.Attr {
	attrs := []slog.Attr{
		slog.String("procedure", req.Spec().Procedure),
		slog.String("status", code.String()),
		slog.Duration("duration", duration),
	}

	appendStringAttr(&attrs, "http_method", req.HTTPMethod())
	appendStringAttr(&attrs, "stream", req.Spec().StreamType.String())
	appendStringAttr(&attrs, "idempotency", req.Spec().IdempotencyLevel.String())

	peer := req.Peer()
	appendStringAttr(&attrs, "peer_addr", peer.Addr)
	appendStringAttr(&attrs, "protocol", peer.Protocol)
	appendStringAttr(&attrs, "query", peer.Query.Encode())

	header := req.Header()
	appendStringAttr(&attrs, "user_agent", header.Get("User-Agent"))
	appendStringAttr(&attrs, "request_id", header.Get("X-Request-Id"))
	appendStringAttr(&attrs, "client_ip", firstForwardedFor(header))
	appendStringAttr(&attrs, "content_type", header.Get("Content-Type"))
	appendStringAttr(&attrs, "accept", header.Get("Accept"))
	appendStringAttr(&attrs, "content_encoding", header.Get("Content-Encoding"))
	appendStringAttr(&attrs, "grpc_encoding", header.Get("Grpc-Encoding"))

	attrs = append(attrs, slog.Int("request_header_count", headerCount(header)))
	if cl := contentLength(header); cl >= 0 {
		attrs = append(attrs, slog.Int("request_bytes", cl))
	}

	return attrs
}

func responseAttributes(resp connect.AnyResponse) []slog.Attr {
	if r, ok := resp.(*connect.Response[any]); !ok || r == nil {
		return nil
	}

	attrs := make([]slog.Attr, 0, 3)
	if cl := contentLength(resp.Header()); cl >= 0 {
		attrs = append(attrs, slog.Int("response_bytes", cl))
	}
	if len(resp.Header()) > 0 {
		attrs = append(attrs, slog.Int("response_header_count", headerCount(resp.Header())))
	}
	if len(resp.Trailer()) > 0 {
		attrs = append(attrs, slog.Int("response_trailer_count", headerCount(resp.Trailer())))
	}
	return attrs
}

func appendStringAttr(attrs *[]slog.Attr, key, value string) {
	if value == "" {
		return
	}
	*attrs = append(*attrs, slog.String(key, value))
}

func firstForwardedFor(header http.Header) string {
	forwarded := header.Get("X-Forwarded-For")
	if forwarded == "" {
		return ""
	}
	for _, part := range strings.Split(forwarded, ",") {
		if candidate := strings.TrimSpace(part); candidate != "" {
			return candidate
		}
	}
	return ""
}

func headerCount(header http.Header) int {
	count := 0
	for key := range header {
		count += len(header[key])
	}
	return count
}

func contentLength(header http.Header) int {
	if header == nil {
		return -1
	}
	if cl := header.Get("Content-Length"); cl != "" {
		if parsed, err := strconv.Atoi(cl); err == nil {
			return parsed
		}
	}
	return -1
}

// serializeMessage converts a protobuf message to JSON string for logging
func serializeMessage(msg any) string {
	if msg == nil {
		return ""
	}

	// Try to cast to proto.Message
	protoMsg, ok := msg.(proto.Message)
	if !ok {
		return fmt.Sprintf("%+v", msg)
	}

	// Use protojson to marshal the message
	marshaler := protojson.MarshalOptions{
		Multiline:       false,
		Indent:          "",
		EmitUnpopulated: true,
		UseProtoNames:   true,
	}

	jsonBytes, err := marshaler.Marshal(protoMsg)
	if err != nil {
		return fmt.Sprintf("failed to marshal: %v", err)
	}

	// Limit the size to prevent huge logs (max 10KB)
	const maxLogSize = 10 * 1024
	if len(jsonBytes) > maxLogSize {
		return string(jsonBytes[:maxLogSize]) + "...(truncated)"
	}

	return string(jsonBytes)
}

// NewLogger builds a configured slog logger for business logs.
func NewLogger(cfg *config.Config) (*slog.Logger, error) {
	level, err := parseLogLevel(cfg.Log.Level)
	if err != nil {
		return nil, fmt.Errorf("parse log level: %w", err)
	}

	handler, err := newHandler(cfg, level)
	if err != nil {
		return nil, err
	}

	return slog.New(handler), nil
}

func newHandler(cfg *config.Config, level slog.Leveler) (slog.Handler, error) {
	writer, err := newLogWriter(cfg)
	if err != nil {
		return nil, err
	}

	opts := &slog.HandlerOptions{
		Level: level,
	}

	if strings.EqualFold(cfg.Log.Format, "text") {
		return slog.NewTextHandler(writer, opts), nil
	}
	return slog.NewJSONHandler(writer, opts), nil
}

func newLogWriter(cfg *config.Config) (io.Writer, error) {
	var writer io.Writer = os.Stdout
	if cfg.Log.File == "" {
		return writer, nil
	}

	logDir := filepath.Dir(cfg.Log.File)
	if err := os.MkdirAll(logDir, 0o750); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}

	file, err := os.OpenFile(cfg.Log.File, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}

	return io.MultiWriter(file, os.Stdout), nil
}

func parseLogLevel(level string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "trace":
		return slog.LevelDebug - 4, nil
	case "debug":
		return slog.LevelDebug, nil
	case "info", "":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	case "fatal", "panic":
		return slog.LevelError + 4, nil
	default:
		return slog.LevelInfo, fmt.Errorf("unsupported log level %q", level)
	}
}

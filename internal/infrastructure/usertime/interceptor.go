package usertime

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
)

const (
	// TimezoneHeader is the HTTP header name for user timezone
	TimezoneHeader = "x-timezone"
)

// UsertimeInterceptor extracts and validates user timezone from request headers
type UsertimeInterceptor struct {
	publicProcedures map[string]bool
}

// NewUsertimeInterceptor creates a new usertime interceptor
// publicProcedures should contain procedure names that don't require timezone
func NewUsertimeInterceptor(publicProcedures []string) *UsertimeInterceptor {
	publicMap := make(map[string]bool, len(publicProcedures))
	for _, proc := range publicProcedures {
		publicMap[proc] = true
	}

	return &UsertimeInterceptor{
		publicProcedures: publicMap,
	}
}

// WrapUnary returns a Connect RPC unary interceptor function
func (i *UsertimeInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// Get procedure name
		procedure := req.Spec().Procedure

		// Extract timezone from header
		timezoneStr := req.Header().Get(TimezoneHeader)

		// For public procedures, timezone is optional
		if i.publicProcedures[procedure] {
			if timezoneStr != "" {
				// Try to parse timezone, but don't fail if invalid
				if loc, err := time.LoadLocation(timezoneStr); err == nil {
					ctx = SetLocation(ctx, loc)
				}
			}
			// Continue without timezone for public endpoints
			return next(ctx, req)
		}

		// For protected procedures, timezone is required
		if timezoneStr == "" {
			return nil, connect.NewError(
				connect.CodeInvalidArgument,
				fmt.Errorf("missing required header: %s", TimezoneHeader),
			)
		}

		// Validate and load timezone location
		loc, err := time.LoadLocation(timezoneStr)
		if err != nil {
			return nil, connect.NewError(
				connect.CodeInvalidArgument,
				fmt.Errorf("invalid timezone '%s': %w (use IANA timezone name like 'Asia/Shanghai')", timezoneStr, err),
			)
		}

		// Store location in context
		ctx = SetLocation(ctx, loc)

		// Proceed with the request
		return next(ctx, req)
	}
}

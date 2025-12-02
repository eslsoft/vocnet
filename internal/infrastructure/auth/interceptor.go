package auth

import (
	"context"
	"strings"

	"connectrpc.com/connect"
)

// AuthInterceptor provides JWT authentication for Connect RPC endpoints
type AuthInterceptor struct {
	validator        *JWTValidator
	publicProcedures map[string]bool
}

// NewAuthInterceptor creates a new auth interceptor
// publicProcedures should contain procedure names that don't require authentication
func NewAuthInterceptor(validator *JWTValidator, publicProcedures []string) *AuthInterceptor {
	publicMap := make(map[string]bool, len(publicProcedures))
	for _, proc := range publicProcedures {
		publicMap[proc] = true
	}

	return &AuthInterceptor{
		validator:        validator,
		publicProcedures: publicMap,
	}
}

// WrapUnary returns a Connect RPC unary interceptor function
func (i *AuthInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// Get procedure name
		procedure := req.Spec().Procedure

		// Skip authentication for public procedures
		if i.publicProcedures[procedure] {
			return next(ctx, req)
		}

		// Extract token from Authorization header
		token := extractBearerToken(req.Header().Get("Authorization"))
		if token == "" {
			return nil, connect.NewError(
				connect.CodeUnauthenticated,
				connect.NewError(connect.CodeUnauthenticated, nil),
			)
		}

		// Validate token and extract claims
		claims, err := i.validator.ValidateToken(ctx, token)
		if err != nil {
			return nil, connect.NewError(
				connect.CodeUnauthenticated,
				err,
			)
		}

		// Extract user ID from claims
		userID, err := claims.UserID()
		if err != nil {
			return nil, connect.NewError(
				connect.CodeUnauthenticated,
				err,
			)
		}

		// Store user ID in context
		ctx = SetUserID(ctx, userID)

		// Proceed with the request
		return next(ctx, req)
	}
}

// extractBearerToken extracts the token from "Bearer <token>" format
func extractBearerToken(authHeader string) string {
	if authHeader == "" {
		return ""
	}

	// Authorization header format: "Bearer <token>"
	const prefix = "Bearer "
	if !strings.HasPrefix(authHeader, prefix) {
		return ""
	}

	return strings.TrimSpace(authHeader[len(prefix):])
}

package auth

import (
	"context"

	"github.com/google/uuid"
)

type contextKey string

const userIDContextKey contextKey = "user_id"

// SetUserID stores the authenticated user ID in context
func SetUserID(ctx context.Context, userID uuid.UUID) context.Context {
	return context.WithValue(ctx, userIDContextKey, userID)
}

// MustGetUserID retrieves the authenticated user ID from context
// For protected endpoints, user_id must exist, otherwise panic
// This is the recommended approach since auth interceptor guarantees user_id existence
func MustGetUserID(ctx context.Context) uuid.UUID {
	val := ctx.Value(userIDContextKey)
	if val == nil {
		panic("auth: user_id not found in context - this should never happen for protected endpoints")
	}

	userID, ok := val.(uuid.UUID)
	if !ok {
		panic("auth: invalid user_id type in context")
	}

	return userID
}

// GetUserIDOrZero retrieves user ID from context, returns zero value if not found
// Used for optional auth scenarios (e.g., Wordbook's GetWordbook can access public wordbooks)
func GetUserIDOrZero(ctx context.Context) uuid.UUID {
	val := ctx.Value(userIDContextKey)
	if val == nil {
		return uuid.Nil
	}

	userID, ok := val.(uuid.UUID)
	if !ok {
		return uuid.Nil
	}

	return userID
}

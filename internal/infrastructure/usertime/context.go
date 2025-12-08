package usertime

import (
	"context"
	"time"
)

type contextKey string

const locationKey contextKey = "usertime.location"

// SetLocation stores the user's timezone location in the context
func SetLocation(ctx context.Context, loc *time.Location) context.Context {
	return context.WithValue(ctx, locationKey, loc)
}

// MustGetLocation retrieves the user's timezone location from context
// Panics if the location is not found - use only for protected endpoints
func MustGetLocation(ctx context.Context) *time.Location {
	loc, ok := ctx.Value(locationKey).(*time.Location)
	if !ok || loc == nil {
		panic("usertime: location not found in context")
	}
	return loc
}

// GetLocationOrUTC retrieves the user's timezone location from context
// Returns UTC if not found - use for public endpoints or as fallback
func GetLocationOrUTC(ctx context.Context) *time.Location {
	loc, ok := ctx.Value(locationKey).(*time.Location)
	if !ok || loc == nil {
		return time.UTC
	}
	return loc
}

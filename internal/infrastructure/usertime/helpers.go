package usertime

import (
	"context"
	"time"
)

// Now returns the current time in the user's timezone
// For protected endpoints, panics if timezone not found in context
func Now(ctx context.Context) time.Time {
	loc := MustGetLocation(ctx)
	return time.Now().In(loc)
}

// NowOrUTC returns the current time in the user's timezone or UTC if not found
// Use for public endpoints or when timezone is optional
func NowOrUTC(ctx context.Context) time.Time {
	loc := GetLocationOrUTC(ctx)
	return time.Now().In(loc)
}

// Today returns the start of the current day (00:00:00) in the user's timezone
func Today(ctx context.Context) time.Time {
	now := Now(ctx)
	y, m, d := now.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, now.Location())
}

// EndOfToday returns the end of the current day (23:59:59.999999999) in the user's timezone
func EndOfToday(ctx context.Context) time.Time {
	now := Now(ctx)
	y, m, d := now.Date()
	return time.Date(y, m, d, 23, 59, 59, int(time.Second-time.Nanosecond), now.Location())
}

// EndOfTodayOrUTC returns the end of the current day in the user's timezone or UTC if not found
// Use for optional timezone or when called from contexts without timezone (e.g., tests)
func EndOfTodayOrUTC(ctx context.Context) time.Time {
	now := NowOrUTC(ctx)
	y, m, d := now.Date()
	return time.Date(y, m, d, 23, 59, 59, int(time.Second-time.Nanosecond), now.Location())
}

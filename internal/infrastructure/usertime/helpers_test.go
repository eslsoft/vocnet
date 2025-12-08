package usertime

import (
	"context"
	"testing"
	"time"
)

func TestNow(t *testing.T) {
	ctx := context.Background()
	loc, _ := time.LoadLocation("Asia/Shanghai")
	ctx = SetLocation(ctx, loc)

	now := Now(ctx)
	if now.Location().String() != "Asia/Shanghai" {
		t.Errorf("Expected Asia/Shanghai timezone, got %s", now.Location().String())
	}

	// Verify it's close to actual time.Now()
	actualNow := time.Now()
	diff := actualNow.Sub(now)
	if diff > time.Second || diff < -time.Second {
		t.Errorf("Now() time differs too much from time.Now(): %v", diff)
	}
}

func TestNowOrUTC_WithLocation(t *testing.T) {
	ctx := context.Background()
	loc, _ := time.LoadLocation("America/Los_Angeles")
	ctx = SetLocation(ctx, loc)

	now := NowOrUTC(ctx)
	if now.Location().String() != "America/Los_Angeles" {
		t.Errorf("Expected America/Los_Angeles timezone, got %s", now.Location().String())
	}
}

func TestNowOrUTC_Fallback(t *testing.T) {
	ctx := context.Background()

	now := NowOrUTC(ctx)
	if now.Location() != time.UTC {
		t.Errorf("Expected UTC timezone, got %s", now.Location().String())
	}
}

func TestToday(t *testing.T) {
	ctx := context.Background()
	loc, _ := time.LoadLocation("Asia/Tokyo")
	ctx = SetLocation(ctx, loc)

	today := Today(ctx)

	// Verify it's start of day (00:00:00)
	if today.Hour() != 0 || today.Minute() != 0 || today.Second() != 0 {
		t.Errorf("Expected start of day, got %02d:%02d:%02d", today.Hour(), today.Minute(), today.Second())
	}

	// Verify it's in the correct timezone
	if today.Location().String() != "Asia/Tokyo" {
		t.Errorf("Expected Asia/Tokyo timezone, got %s", today.Location().String())
	}

	// Verify it's today's date
	now := Now(ctx)
	if today.Year() != now.Year() || today.Month() != now.Month() || today.Day() != now.Day() {
		t.Errorf("Expected today's date, got %v", today)
	}
}

func TestEndOfToday(t *testing.T) {
	ctx := context.Background()
	loc, _ := time.LoadLocation("Europe/Paris")
	ctx = SetLocation(ctx, loc)

	endOfDay := EndOfToday(ctx)

	// Verify it's end of day (23:59:59.999999999)
	if endOfDay.Hour() != 23 || endOfDay.Minute() != 59 || endOfDay.Second() != 59 {
		t.Errorf("Expected end of day, got %02d:%02d:%02d", endOfDay.Hour(), endOfDay.Minute(), endOfDay.Second())
	}

	// Verify it's in the correct timezone
	if endOfDay.Location().String() != "Europe/Paris" {
		t.Errorf("Expected Europe/Paris timezone, got %s", endOfDay.Location().String())
	}

	// Verify it's today's date
	now := Now(ctx)
	if endOfDay.Year() != now.Year() || endOfDay.Month() != now.Month() || endOfDay.Day() != now.Day() {
		t.Errorf("Expected today's date, got %v", endOfDay)
	}
}

func TestTodayAndEndOfToday_Boundary(t *testing.T) {
	ctx := context.Background()
	loc, _ := time.LoadLocation("UTC")
	ctx = SetLocation(ctx, loc)

	today := Today(ctx)
	endOfToday := EndOfToday(ctx)

	// Verify they're on the same day
	if today.Year() != endOfToday.Year() || today.Month() != endOfToday.Month() || today.Day() != endOfToday.Day() {
		t.Errorf("Today and EndOfToday should be the same day")
	}

	// Verify endOfToday is after today
	if !endOfToday.After(today) {
		t.Error("EndOfToday should be after Today")
	}

	// Verify duration between them is close to 24 hours
	duration := endOfToday.Sub(today)
	expected := 24*time.Hour - time.Nanosecond
	if duration != expected {
		t.Errorf("Expected duration ~24h, got %v", duration)
	}
}

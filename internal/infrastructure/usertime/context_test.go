package usertime

import (
	"context"
	"testing"
	"time"
)

func TestSetLocation(t *testing.T) {
	ctx := context.Background()
	loc, _ := time.LoadLocation("Asia/Shanghai")

	newCtx := SetLocation(ctx, loc)

	retrievedLoc := MustGetLocation(newCtx)
	if retrievedLoc != loc {
		t.Errorf("Expected location %v, got %v", loc, retrievedLoc)
	}
}

func TestMustGetLocation_Success(t *testing.T) {
	ctx := context.Background()
	loc, _ := time.LoadLocation("America/New_York")
	ctx = SetLocation(ctx, loc)

	retrievedLoc := MustGetLocation(ctx)
	if retrievedLoc.String() != "America/New_York" {
		t.Errorf("Expected America/New_York, got %s", retrievedLoc.String())
	}
}

func TestMustGetLocation_Panic(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected panic when location not in context")
		}
	}()

	ctx := context.Background()
	MustGetLocation(ctx) // Should panic
}

func TestGetLocationOrUTC_WithLocation(t *testing.T) {
	ctx := context.Background()
	loc, _ := time.LoadLocation("Europe/London")
	ctx = SetLocation(ctx, loc)

	retrievedLoc := GetLocationOrUTC(ctx)
	if retrievedLoc.String() != "Europe/London" {
		t.Errorf("Expected Europe/London, got %s", retrievedLoc.String())
	}
}

func TestGetLocationOrUTC_Fallback(t *testing.T) {
	ctx := context.Background()

	retrievedLoc := GetLocationOrUTC(ctx)
	if retrievedLoc != time.UTC {
		t.Errorf("Expected UTC, got %v", retrievedLoc)
	}
}

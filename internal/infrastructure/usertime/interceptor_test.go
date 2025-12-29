package usertime

import (
	"testing"
	"time"
)

func TestNewUsertimeInterceptor(t *testing.T) {
	publicProcs := []string{"/dict.v1.DictService/LookupWord", "/dict.v1.DictService/LookupWordForms"}
	interceptor := NewUsertimeInterceptor(publicProcs)

	if interceptor == nil {
		t.Fatal("Expected non-nil interceptor")
	}

	// Verify public procedures are registered
	if !interceptor.publicProcedures["/dict.v1.DictService/LookupWord"] {
		t.Error("Expected LookupWord to be registered as public")
	}

	if !interceptor.publicProcedures["/dict.v1.DictService/LookupWordForms"] {
		t.Error("Expected LookupWordForms to be registered as public")
	}

	// Verify non-public procedures are not registered
	if interceptor.publicProcedures["/learning.v1.LearningService/GetFlashCards"] {
		t.Error("Expected GetFlashCards to not be public")
	}
}

func TestTimezoneHeader_Constant(t *testing.T) {
	expected := "x-timezone"
	if TimezoneHeader != expected {
		t.Errorf("Expected TimezoneHeader to be %q, got %q", expected, TimezoneHeader)
	}
}

func TestLoadLocation_ValidTimezones(t *testing.T) {
	// Test that common IANA timezone names can be loaded
	testCases := []string{
		"Asia/Shanghai",
		"America/New_York",
		"Europe/London",
		"Asia/Tokyo",
		"UTC",
	}

	for _, tz := range testCases {
		t.Run(tz, func(t *testing.T) {
			loc, err := time.LoadLocation(tz)
			if err != nil {
				t.Fatalf("Failed to load timezone %s: %v", tz, err)
			}
			if loc.String() != tz {
				t.Errorf("Expected timezone %s, got %s", tz, loc.String())
			}
		})
	}
}

func TestLoadLocation_InvalidTimezone(t *testing.T) {
	invalidTimezones := []string{
		"Invalid/Timezone",
		"PST",   // Abbreviations are not valid IANA names
		"GMT+8", // This format is not valid
		"Not/A/TimeZone",
	}

	for _, tz := range invalidTimezones {
		t.Run(tz, func(t *testing.T) {
			_, err := time.LoadLocation(tz)
			if err == nil {
				t.Errorf("Expected error for invalid timezone %s, but got none", tz)
			}
		})
	}
}

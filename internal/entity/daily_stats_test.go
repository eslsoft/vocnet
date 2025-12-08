package entity

import (
	"testing"
	"time"
)

func TestNormalizeDate(t *testing.T) {
	// 测试：CST 时区 (UTC+8) 的日期规范化
	cstLoc := time.FixedZone("CST", 8*3600)

	tests := []struct {
		name     string
		input    time.Time
		expected string // 期望的日期部分
	}{
		{
			name:     "CST早上时间应该是当天",
			input:    time.Date(2025, 12, 8, 10, 30, 0, 0, cstLoc),
			expected: "2025-12-08",
		},
		{
			name:     "CST午夜应该是当天",
			input:    time.Date(2025, 12, 8, 0, 0, 0, 0, cstLoc),
			expected: "2025-12-08",
		},
		{
			name:     "CST深夜应该是当天",
			input:    time.Date(2025, 12, 8, 23, 59, 59, 0, cstLoc),
			expected: "2025-12-08",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := NormalizeDate(tt.input)

			// 检查日期部分
			y, m, d := result.Date()
			resultDate := time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Format("2006-01-02")

			if resultDate != tt.expected {
				t.Errorf("NormalizeDate() = %v, want %v", resultDate, tt.expected)
			}

			// 检查时间部分是否是午夜
			if result.Hour() != 0 || result.Minute() != 0 || result.Second() != 0 {
				t.Errorf("NormalizeDate() should be midnight, got %v:%v:%v",
					result.Hour(), result.Minute(), result.Second())
			}
		})
	}
}

func TestNormalizeDatePreservesTimezone(t *testing.T) {
	// 测试：确保时区信息被保留
	cstLoc := time.FixedZone("CST", 8*3600)
	input := time.Date(2025, 12, 8, 15, 30, 0, 0, cstLoc)

	result := NormalizeDate(input)

	// NormalizeDate should return UTC midnight
	if result.Location() != time.UTC {
		t.Errorf("Expected UTC timezone, got %v", result.Location())
	}

	// Verify it's midnight (00:00:00)
	if result.Hour() != 0 || result.Minute() != 0 || result.Second() != 0 {
		t.Errorf("Expected midnight (00:00:00), got %02d:%02d:%02d",
			result.Hour(), result.Minute(), result.Second())
	}

	// Verify it's the same calendar date as the input (in input's timezone)
	y, m, d := input.Date()
	if result.Year() != y || result.Month() != m || result.Day() != d {
		t.Errorf("Expected date %04d-%02d-%02d, got %04d-%02d-%02d",
			y, m, d, result.Year(), result.Month(), result.Day())
	}
}

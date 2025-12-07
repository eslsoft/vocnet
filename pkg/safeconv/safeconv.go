package safeconv

import "math"

// Int64ToInt32 safely converts int64 to int32 by clamping to the int32 range.
func Int64ToInt32(v int64) int32 {
	switch {
	case v > math.MaxInt32:
		return math.MaxInt32
	case v < math.MinInt32:
		return math.MinInt32
	default:
		return int32(v)
	}
}

// IntToInt32 safely converts int to int32 by delegating to Int64ToInt32.
func IntToInt32(v int) int32 {
	return Int64ToInt32(int64(v))
}

package connectrpc

import (
	"fmt"
	"math"
)

func safeInt32(name string, value int64) (int32, error) {
	if value > math.MaxInt32 || value < math.MinInt32 {
		return 0, fmt.Errorf("%s out of int32 range: %d", name, value)
	}
	return int32(value), nil
}

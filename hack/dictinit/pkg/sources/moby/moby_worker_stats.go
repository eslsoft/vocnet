package moby

import (
	"log"
	"strings"
	"sync/atomic"
)

type mobyWorkerStats struct {
	succeeded int64
	skipped   int64
	failed    int64
}

func (s *mobyWorkerStats) applyResult(err error, skippedLogCount *int64) {
	if err != nil {
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "skipped") {
			s.skipped++
			newSkipped := atomic.AddInt64(skippedLogCount, 1)
			// Sample log every 5000 skipped items
			if newSkipped%5000 == 0 {
				log.Printf("[moby] Skipped sample: %v", err)
			}
		} else {
			s.failed++
		}
		return
	}
	s.succeeded++
}

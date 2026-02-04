package report

import (
	"encoding/json"
	"fmt"
	"os"
)

type MissingChineseAnalysis struct {
	TotalMissing int64                  `json:"total_missing"`
	ByPOS        map[string][]string    `json:"by_pos_samples"`
	TopUncovered []UncoveredWord        `json:"top_uncovered"` // Based on frequency or importance
}

type UncoveredWord struct {
	Term  string `json:"term"`
	POS   string `json:"pos"`
	Level int32  `json:"level,omitempty"`
}

func SaveMissingChineseAnalysis(analysis *MissingChineseAnalysis, filePath string) error {
	data, err := json.MarshalIndent(analysis, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal analysis: %w", err)
	}
	return os.WriteFile(filePath, data, 0644)
}

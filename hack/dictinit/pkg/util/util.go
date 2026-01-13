package util

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func ExpandHome(path string) (string, error) {
	if path == "" || path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home dir: %w", err)
		}
		return home, nil
	}
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home dir: %w", err)
		}
		return filepath.Join(home, path[2:]), nil
	}
	return path, nil
}

func NormalizeKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

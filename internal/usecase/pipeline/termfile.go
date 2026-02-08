package pipeline

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ParseTermFile reads terms from a file.
// Supported formats:
//   - .txt: one word per line (blank lines and # comments are ignored)
//   - .json: JSON string array ["word1", "word2", ...]
//   - other: auto-detect (try JSON first, fall back to line-based)
func ParseTermFile(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open term file: %w", err)
	}
	defer func() { _ = f.Close() }()

	ext := strings.ToLower(filepath.Ext(path))
	return ParseTerms(f, ext)
}

// ParseTerms parses terms from a reader.
// format should be ".json", ".txt", or empty for auto-detect.
func ParseTerms(r io.Reader, format string) ([]string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}

	switch format {
	case ".json":
		return parseJSON(data)
	case ".txt":
		return parseLines(data), nil
	default:
		// Auto-detect: try JSON first
		terms, err := parseJSON(data)
		if err == nil {
			return terms, nil
		}
		return parseLines(data), nil
	}
}

func parseJSON(data []byte) ([]string, error) {
	var terms []string
	if err := json.Unmarshal(data, &terms); err != nil {
		return nil, fmt.Errorf("parse JSON: %w", err)
	}
	// Trim whitespace from each term
	out := make([]string, 0, len(terms))
	for _, t := range terms {
		t = strings.TrimSpace(t)
		if t != "" {
			out = append(out, t)
		}
	}
	return out, nil
}

func parseLines(data []byte) []string {
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	var terms []string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		terms = append(terms, line)
	}
	return terms
}

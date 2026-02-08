package moby

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"
)

// Reader provides access to Moby Hyphenation data
type Reader struct {
	filePath string
	// syllables maps word (lowercase) -> syllable list
	syllables map[string][]string
}

// NewReader creates a new Moby reader
func NewReader(filePath string) (*Reader, error) {
	if filePath == "" {
		return nil, fmt.Errorf("moby file path is required")
	}

	r := &Reader{
		filePath:  filePath,
		syllables: make(map[string][]string),
	}

	// Load syllables into memory
	if err := r.load(); err != nil {
		return nil, err
	}

	return r, nil
}

// load reads the Moby hyphenation file and builds an in-memory index
func (r *Reader) load() error {
	file, err := os.Open(r.filePath)
	if err != nil {
		return fmt.Errorf("open moby file: %w", err)
	}
	defer func() { _ = file.Close() }()

	scanner := bufio.NewScanner(file)
	lineNum := 0
	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		syllables := parseSyllables(line)
		if len(syllables) == 0 {
			continue
		}

		// Reconstruct word and store lowercase key
		word := strings.Join(syllables, "")
		key := strings.ToLower(word)

		r.syllables[key] = syllables
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scan moby file: %w", err)
	}

	return nil
}

// Lookup returns syllables for a word (case-insensitive)
func (r *Reader) Lookup(ctx context.Context, word string) ([]string, error) {
	key := strings.ToLower(word)
	syllables, ok := r.syllables[key]
	if !ok {
		return nil, nil // Not found
	}

	// Return a copy to prevent modification
	result := make([]string, len(syllables))
	copy(result, syllables)
	return result, nil
}

// parseSyllables parses a Moby hyphenation line into syllables
// Moby format uses: 0xA5 (bullet separator), hyphens, or bullets
// Example: "a•bil•i•ty" or "a-bil-i-ty"
func parseSyllables(line string) []string {
	if line == "" {
		return nil
	}

	// Replace 0xA5 (Moby separator) with space
	normalized := make([]byte, 0, len(line))
	for i := 0; i < len(line); i++ {
		b := line[i]
		if b == 0xA5 {
			normalized = append(normalized, ' ')
		} else {
			normalized = append(normalized, b)
		}
	}

	// Replace bullet and hyphen separators with space
	text := string(normalized)
	text = strings.ReplaceAll(text, "•", " ")
	text = strings.ReplaceAll(text, "-", " ")

	// Split and filter
	parts := strings.Fields(text)
	if len(parts) <= 1 {
		return nil // Single syllable or invalid
	}

	return parts
}

// Close closes the reader (no-op for in-memory reader)
func (r *Reader) Close() error {
	return nil
}

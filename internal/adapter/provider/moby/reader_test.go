package moby

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestReader_Lookup(t *testing.T) {
	// Create a temporary test file with Moby format data
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test_moby.txt")

	testData := `a•bil•i•ty
com•put•er
hel•lo
run•ning
test`

	if err := os.WriteFile(testFile, []byte(testData), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Create reader
	reader, err := NewReader(testFile)
	if err != nil {
		t.Fatalf("Failed to create reader: %v", err)
	}
	defer func() { _ = reader.Close() }()

	tests := []struct {
		word     string
		expected []string
	}{
		{
			word:     "ability",
			expected: []string{"a", "bil", "i", "ty"},
		},
		{
			word:     "computer",
			expected: []string{"com", "put", "er"},
		},
		{
			word:     "hello",
			expected: []string{"hel", "lo"},
		},
		{
			word:     "running",
			expected: []string{"run", "ning"},
		},
		{
			word:     "test",
			expected: nil, // Single syllable, should return nil
		},
		{
			word:     "notfound",
			expected: nil, // Not in data
		},
	}

	ctx := context.Background()
	for _, tt := range tests {
		t.Run(tt.word, func(t *testing.T) {
			syllables, err := reader.Lookup(ctx, tt.word)
			if err != nil {
				t.Errorf("Lookup failed: %v", err)
				return
			}

			if len(syllables) != len(tt.expected) {
				t.Errorf("Expected %d syllables, got %d", len(tt.expected), len(syllables))
				return
			}

			for i, expected := range tt.expected {
				if syllables[i] != expected {
					t.Errorf("Syllable %d: expected %q, got %q", i, expected, syllables[i])
				}
			}
		})
	}
}

func TestReader_CaseInsensitive(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test_moby.txt")

	testData := `Hel•lo`

	if err := os.WriteFile(testFile, []byte(testData), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	reader, err := NewReader(testFile)
	if err != nil {
		t.Fatalf("Failed to create reader: %v", err)
	}
	defer func() { _ = reader.Close() }()

	ctx := context.Background()

	// Test lowercase
	syllables, err := reader.Lookup(ctx, "hello")
	if err != nil {
		t.Fatalf("Lookup failed: %v", err)
	}
	if len(syllables) != 2 || syllables[0] != "Hel" || syllables[1] != "lo" {
		t.Errorf("Expected [Hel lo], got %v", syllables)
	}

	// Test uppercase
	syllables, err = reader.Lookup(ctx, "HELLO")
	if err != nil {
		t.Fatalf("Lookup failed: %v", err)
	}
	if len(syllables) != 2 {
		t.Errorf("Expected 2 syllables for uppercase, got %d", len(syllables))
	}

	// Test mixed case
	syllables, err = reader.Lookup(ctx, "HeLLo")
	if err != nil {
		t.Fatalf("Lookup failed: %v", err)
	}
	if len(syllables) != 2 {
		t.Errorf("Expected 2 syllables for mixed case, got %d", len(syllables))
	}
}

func TestParseSyllables(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{
			input:    "a•bil•i•ty",
			expected: []string{"a", "bil", "i", "ty"},
		},
		{
			input:    "com-put-er",
			expected: []string{"com", "put", "er"},
		},
		{
			input:    "test",
			expected: nil, // Single syllable
		},
		{
			input:    "",
			expected: nil,
		},
		{
			input:    "run ning", // Space separated (after 0xA5 conversion)
			expected: []string{"run", "ning"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := parseSyllables(tt.input)
			if len(result) != len(tt.expected) {
				t.Errorf("Expected %d syllables, got %d", len(tt.expected), len(result))
				return
			}
			for i, expected := range tt.expected {
				if result[i] != expected {
					t.Errorf("Syllable %d: expected %q, got %q", i, expected, result[i])
				}
			}
		})
	}
}

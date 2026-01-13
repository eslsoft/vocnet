package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexemeform"
)

// WordbookCoverageResult contains coverage statistics for a single wordbook
type WordbookCoverageResult struct {
	Name            string
	TotalWords      int
	CoveredWords    int
	UncoveredWords  []string
	CoveragePercent float64
}

// CheckWordbookCoverage checks which words in wordbooks are covered by lemma data
func CheckWordbookCoverage(ctx context.Context, client *ent.Client, wordbookDir string) ([]WordbookCoverageResult, error) {
	// Find all JSON files in wordbook directory
	files, err := filepath.Glob(filepath.Join(wordbookDir, "*.json"))
	if err != nil {
		return nil, fmt.Errorf("failed to list wordbook files: %w", err)
	}

	results := make([]WordbookCoverageResult, 0, len(files))

	for _, file := range files {
		name := strings.TrimSuffix(filepath.Base(file), ".json")

		// Read wordbook file
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, fmt.Errorf("failed to read %s: %w", name, err)
		}

		var words []string
		if err := json.Unmarshal(data, &words); err != nil {
			return nil, fmt.Errorf("failed to parse %s: %w", name, err)
		}

		// Check coverage for each word
		result := WordbookCoverageResult{
			Name:           name,
			TotalWords:     len(words),
			UncoveredWords: make([]string, 0),
		}

		for _, word := range words {
			// Normalize word to lowercase for case-insensitive lookup
			normalized := strings.ToLower(word)

			// Check if lemma exists in database
			exists, err := client.Lemma.Query().
				Where(lemma.NormalizedEQ(normalized)).
				Exist(ctx)

			if err != nil {
				return nil, fmt.Errorf("failed to query lemma for %s: %w", word, err)
			}

			if !exists {
				// Fallback: Check if word exists in forms table
				exists, err = client.LexemeForm.Query().
					Where(lexemeform.NormalizedEQ(normalized)).
					Exist(ctx)
				if err != nil {
					return nil, fmt.Errorf("failed to query forms for %s: %w", word, err)
				}
			}

			if exists {
				result.CoveredWords++
			} else {
				result.UncoveredWords = append(result.UncoveredWords, word)
			}
		}

		// Calculate coverage percentage
		if result.TotalWords > 0 {
			result.CoveragePercent = float64(result.CoveredWords) / float64(result.TotalWords) * 100
		}

		results = append(results, result)
	}

	// Sort results by name
	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results, nil
}

// PrintCoverageReport prints a formatted coverage report
func PrintCoverageReport(results []WordbookCoverageResult) {
	fmt.Println("\n" + strings.Repeat("=", 80))
	fmt.Println("WORDBOOK COVERAGE REPORT")
	fmt.Println(strings.Repeat("=", 80))
	fmt.Println()

	totalWords := 0
	totalCovered := 0

	for _, result := range results {
		totalWords += result.TotalWords
		totalCovered += result.CoveredWords

		fmt.Printf("📚 %s\n", result.Name)
		fmt.Printf("   Total Words:      %d\n", result.TotalWords)
		fmt.Printf("   Covered Words:    %d\n", result.CoveredWords)
		fmt.Printf("   Uncovered Words:  %d\n", len(result.UncoveredWords))
		fmt.Printf("   Coverage:         %.2f%%\n", result.CoveragePercent)

		if len(result.UncoveredWords) > 0 {
			fmt.Printf("   Missing:          %s", result.UncoveredWords[0])
			if len(result.UncoveredWords) > 1 {
				fmt.Printf(", %s", result.UncoveredWords[1])
			}
			if len(result.UncoveredWords) > 2 {
				fmt.Printf(", %s", result.UncoveredWords[2])
			}
			if len(result.UncoveredWords) > 3 {
				fmt.Printf(" ... (+%d more)", len(result.UncoveredWords)-3)
			}
			fmt.Println()
		}
		fmt.Println()
	}

	fmt.Println(strings.Repeat("-", 80))
	fmt.Printf("OVERALL STATISTICS\n")
	fmt.Printf("   Total Words Across All Wordbooks:  %d\n", totalWords)
	fmt.Printf("   Total Covered Words:               %d\n", totalCovered)
	fmt.Printf("   Total Uncovered Words:             %d\n", totalWords-totalCovered)
	if totalWords > 0 {
		fmt.Printf("   Overall Coverage:                  %.2f%%\n", float64(totalCovered)/float64(totalWords)*100)
	}
	fmt.Println(strings.Repeat("=", 80))
	fmt.Println()
}

// SaveUncoveredWordsReport saves detailed uncovered words to a file
func SaveUncoveredWordsReport(results []WordbookCoverageResult, outputFile string) error {
	f, err := os.Create(outputFile)
	if err != nil {
		return fmt.Errorf("failed to create output file: %w", err)
	}
	defer f.Close()

	fmt.Fprintf(f, "# Uncovered Words Report\n\n")
	fmt.Fprintf(f, "This report lists all words from wordbooks that are not covered by the lemma database.\n\n")

	for _, result := range results {
		if len(result.UncoveredWords) == 0 {
			continue
		}

		fmt.Fprintf(f, "## %s\n\n", result.Name)
		fmt.Fprintf(f, "Coverage: %.2f%% (%d/%d words covered)\n\n",
			result.CoveragePercent, result.CoveredWords, result.TotalWords)
		fmt.Fprintf(f, "Uncovered words (%d):\n\n", len(result.UncoveredWords))

		for i, word := range result.UncoveredWords {
			fmt.Fprintf(f, "%d. %s\n", i+1, word)
		}
		fmt.Fprintf(f, "\n")
	}

	fmt.Printf("\n✅ Detailed report saved to: %s\n", outputFile)
	return nil
}

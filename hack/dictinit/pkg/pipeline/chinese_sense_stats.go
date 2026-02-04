package pipeline

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
)

// ChineseSenseStats holds statistics about Chinese sense coverage
type ChineseSenseStats struct {
	TotalLexemes         int64
	WithChineseSense     int64
	WithoutChineseSense  int64
	PercentWithChinese   float64
	PercentWithoutChinese float64

	// Per part-of-speech breakdown
	ByPOS map[string]*POSSenseStats

	// Detailed analysis for investigation
	MissingTermsByPOS map[string][]string
}

type POSSenseStats struct {
	Total              int64
	WithChineseSense   int64
	WithoutChineseSense int64
}

// CheckChineseSenseCoverage checks how many lexemes have Chinese translations
func CheckChineseSenseCoverage(ctx context.Context, client *entdb.Client) (*ChineseSenseStats, error) {
	log.Printf("[chinese-sense] Starting Chinese sense coverage check...")

	stats := &ChineseSenseStats{
		ByPOS:             make(map[string]*POSSenseStats),
		MissingTermsByPOS: make(map[string][]string),
	}

	batchSize := 1000
	offset := 0

	for {
		// Query lexemes in batches
		lexemes, err := client.Lexeme.Query().
			Where(lexeme.LanguageCode("en")).
			WithLemmas().
			Limit(batchSize).
			Offset(offset).
			All(ctx)
		if err != nil {
			return nil, fmt.Errorf("query lexemes batch at offset %d: %w", offset, err)
		}

		if len(lexemes) == 0 {
			break
		}

		stats.TotalLexemes += int64(len(lexemes))

		for _, lex := range lexemes {
			hasChineseSense := false

			// Check if any sense has Chinese language
			for _, sense := range lex.Senses {
				if isChineseLanguage(sense.Language) {
					hasChineseSense = true
					break
				}
			}

			// Update POS stats
			pos := lex.Pos
			if pos == "" {
				pos = "UNSPECIFIED"
			}

			if stats.ByPOS[pos] == nil {
				stats.ByPOS[pos] = &POSSenseStats{}
			}

			stats.ByPOS[pos].Total++

			// Update overall stats
			if hasChineseSense {
				stats.WithChineseSense++
				stats.ByPOS[pos].WithChineseSense++
			} else {
				stats.WithoutChineseSense++
				stats.ByPOS[pos].WithoutChineseSense++

				// Collect samples for investigation (limit per POS to avoid huge report)
				if len(stats.MissingTermsByPOS[pos]) < 100 {
					term := ""
					if len(lex.Edges.Lemmas) > 0 {
						term = lex.Edges.Lemmas[0].Surface
					}
					if term != "" {
						stats.MissingTermsByPOS[pos] = append(stats.MissingTermsByPOS[pos], term)
					}
				}
			}
		}

		offset += len(lexemes)
		if offset % 5000 == 0 {
			log.Printf("[chinese-sense] Processed %d lexemes...", offset)
		}
	}

	// Calculate percentages
	if stats.TotalLexemes > 0 {
		stats.PercentWithChinese = float64(stats.WithChineseSense) / float64(stats.TotalLexemes) * 100
		stats.PercentWithoutChinese = float64(stats.WithoutChineseSense) / float64(stats.TotalLexemes) * 100
	}

	// Save detailed analysis to file
	analysis := &report.MissingChineseAnalysis{
		TotalMissing: stats.WithoutChineseSense,
		ByPOS:        stats.MissingTermsByPOS,
	}
	_ = os.MkdirAll("reports", 0755)
	if err := report.SaveMissingChineseAnalysis(analysis, "reports/missing_chinese_analysis.json"); err != nil {
		log.Printf("[chinese-sense] Warning: failed to save analysis: %v", err)
	}

	log.Printf("[chinese-sense] Check completed: %d total, %d with Chinese, %d without Chinese",
		stats.TotalLexemes, stats.WithChineseSense, stats.WithoutChineseSense)

	return stats, nil
}

// isChineseLanguage checks if a language code represents Chinese
func isChineseLanguage(lang entity.Language) bool {
	code := lang.Code()
	return code == "zh" || code == "zh-Hans" || code == "zh-Hant" || code == "cmn"
}

// PrintChineseSenseStats prints a formatted report of Chinese sense coverage
func PrintChineseSenseStats(stats *ChineseSenseStats) {
	fmt.Println("\n" + strings.Repeat("=", 80))
	fmt.Println("🇨🇳 Chinese Sense Coverage Report")
	fmt.Println(strings.Repeat("=", 80))

	fmt.Printf("\n📊 Overall Statistics:\n")
	fmt.Printf("  Total Lexemes: %d\n", stats.TotalLexemes)
	fmt.Printf("  With Chinese Translation: %d (%.2f%%)\n",
		stats.WithChineseSense, stats.PercentWithChinese)
	fmt.Printf("  Without Chinese Translation: %d (%.2f%%)\n",
		stats.WithoutChineseSense, stats.PercentWithoutChinese)

	if len(stats.ByPOS) > 0 {
		fmt.Printf("\n📋 Breakdown by Part of Speech:\n")

		// Sort POS by total count for consistent output
		type posPair struct {
			pos   string
			stats *POSSenseStats
		}

		var pairs []posPair
		for pos, posStats := range stats.ByPOS {
			pairs = append(pairs, posPair{pos, posStats})
		}

		// Simple sort by total (descending)
		for i := 0; i < len(pairs); i++ {
			for j := i + 1; j < len(pairs); j++ {
				if pairs[j].stats.Total > pairs[i].stats.Total {
					pairs[i], pairs[j] = pairs[j], pairs[i]
				}
			}
		}

		for _, pair := range pairs {
			pos := pair.pos
			posStats := pair.stats

			percentWith := float64(0)
			if posStats.Total > 0 {
				percentWith = float64(posStats.WithChineseSense) / float64(posStats.Total) * 100
			}

			fmt.Printf("  %-15s: %5d total | %5d with Chinese (%.1f%%) | %5d without\n",
				pos,
				posStats.Total,
				posStats.WithChineseSense,
				percentWith,
				posStats.WithoutChineseSense)
		}
	}

	fmt.Println(strings.Repeat("=", 80))
}

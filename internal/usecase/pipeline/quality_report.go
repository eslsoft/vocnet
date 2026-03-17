package pipeline

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

// QualityReport represents the complete quality test report
type QualityReport struct {
	Timestamp     time.Time               `json:"timestamp"`
	TotalBooks    int                     `json:"total_books"`
	TotalWords    int                     `json:"total_words"`
	TotalPassed   int                     `json:"total_passed"`
	TotalFailed   int                     `json:"total_failed"`
	AverageScore  float64                 `json:"average_score"`
	BookReports   []WordbookQualityReport `json:"book_reports"`
	ExecutionTime string                  `json:"execution_time"`
}

// WordbookQualityReport represents quality metrics for a single wordbook
type WordbookQualityReport struct {
	Name              string           `json:"name"`
	TotalWords        int              `json:"total_words"`
	TestedWords       int              `json:"tested_words"`
	PassedWords       int              `json:"passed_words"`
	FailedWords       int              `json:"failed_words"`
	AverageScore      float64          `json:"average_score"`
	MinScore          float64          `json:"min_score"`
	MaxScore          float64          `json:"max_score"`
	MinRequirement    float64          `json:"min_requirement"`
	TargetScore       float64          `json:"target_score"`
	ScoreDistribution map[string]int   `json:"score_distribution"` // "0-20", "20-40", "40-60", "60-80", "80-100"
	FailedTerms       []FailedTerm     `json:"failed_terms,omitempty"`
	ExecutionErrors   []string         `json:"execution_errors,omitempty"`
	Status            string           `json:"status"` // "passed", "failed", "error"
	LemmaAccuracy     float64          `json:"lemma_accuracy"`               // 0-100%
	LemmaMismatches   []LemmaMismatch  `json:"lemma_mismatches,omitempty"`
}

// FailedTerm represents a word that didn't meet quality requirements
type FailedTerm struct {
	Term           string  `json:"term"`
	Score          float64 `json:"score"`
	MinRequirement float64 `json:"min_requirement"`
	Reason         string  `json:"reason"`
}

// LemmaMismatch represents a word whose resolved lemma is not a prefix of the term
type LemmaMismatch struct {
	Term        string `json:"term"`
	ActualLemma string `json:"actual_lemma"`
}

// SaveAsJSON saves the report to a JSON file
func (r *QualityReport) SaveAsJSON(filepath string) error {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal report: %w", err)
	}
	if err := os.WriteFile(filepath, data, 0644); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	return nil
}

// LoadFromJSON loads a report from a JSON file
func LoadQualityReportFromJSON(filepath string) (*QualityReport, error) {
	data, err := os.ReadFile(filepath)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}
	var report QualityReport
	if err := json.Unmarshal(data, &report); err != nil {
		return nil, fmt.Errorf("unmarshal report: %w", err)
	}
	return &report, nil
}

// GenerateMarkdown generates a human-readable markdown report
func (r *QualityReport) GenerateMarkdown() string {
	var sb strings.Builder

	sb.WriteString("# Pipeline Quality Report\n\n")
	fmt.Fprintf(&sb, "**Generated:** %s\n\n", r.Timestamp.Format(time.RFC3339))
	fmt.Fprintf(&sb, "**Execution Time:** %s\n\n", r.ExecutionTime)

	// Summary section
	sb.WriteString("## Summary\n\n")
	fmt.Fprintf(&sb, "- **Total Wordbooks:** %d\n", r.TotalBooks)
	fmt.Fprintf(&sb, "- **Total Words Tested:** %d\n", r.TotalWords)
	fmt.Fprintf(&sb, "- **Passed:** %d\n", r.TotalPassed)
	fmt.Fprintf(&sb, "- **Failed:** %d\n", r.TotalFailed)
	fmt.Fprintf(&sb, "- **Average Score:** %.2f\n\n", r.AverageScore)

	// Wordbook details
	sb.WriteString("## Wordbook Details\n\n")
	sb.WriteString("| Wordbook | Words Tested | Avg Score | Status | Min Req | Target |\n")
	sb.WriteString("|----------|--------------|-----------|--------|---------|--------|\n")

	for _, book := range r.BookReports {
		status := "✅"
		switch book.Status {
		case "failed":
			status = "❌"
		case "error":
			status = "⚠️"
		}

		fmt.Fprintf(&sb, "| %s | %d | %.2f | %s | %.2f | %.2f |\n",
			book.Name, book.TestedWords, book.AverageScore, status,
			book.MinRequirement, book.TargetScore)
	}

	// Failed wordbooks section
	failedBooks := make([]WordbookQualityReport, 0)
	for _, book := range r.BookReports {
		if book.Status != "passed" {
			failedBooks = append(failedBooks, book)
		}
	}

	if len(failedBooks) > 0 {
		sb.WriteString("\n## Failed Wordbooks\n\n")
		for _, book := range failedBooks {
			fmt.Fprintf(&sb, "### %s\n\n", book.Name)
			fmt.Fprintf(&sb, "- **Status:** %s\n", book.Status)
			fmt.Fprintf(&sb, "- **Average Score:** %.2f (required: %.2f)\n", book.AverageScore, book.MinRequirement)
			fmt.Fprintf(&sb, "- **Failed Words:** %d/%d\n\n", book.FailedWords, book.TestedWords)

			if len(book.ExecutionErrors) > 0 {
				sb.WriteString("**Execution Errors:**\n")
				for _, err := range book.ExecutionErrors {
					fmt.Fprintf(&sb, "- %s\n", err)
				}
				sb.WriteString("\n")
			}

			if len(book.FailedTerms) > 0 {
				sb.WriteString("**Failed Terms:**\n\n")
				sb.WriteString("| Term | Score | Required | Reason |\n")
				sb.WriteString("|------|-------|----------|--------|\n")
				for _, term := range book.FailedTerms {
					fmt.Fprintf(&sb, "| %s | %.2f | %.2f | %s |\n",
						term.Term, term.Score, term.MinRequirement, term.Reason)
				}
				sb.WriteString("\n")
			}
		}
	}

	return sb.String()
}

// CompareTo generates a delta report comparing this report to a baseline
func (r *QualityReport) CompareTo(baseline *QualityReport) *QualityDelta {
	delta := &QualityDelta{
		Timestamp:         r.Timestamp,
		BaselineTimestamp: baseline.Timestamp,
		OverallDelta:      r.AverageScore - baseline.AverageScore,
		BookDeltas:        make([]WordbookDelta, 0),
	}

	// Create maps for quick lookup
	baselineBooks := make(map[string]WordbookQualityReport)
	for _, book := range baseline.BookReports {
		baselineBooks[book.Name] = book
	}

	// Compare each wordbook
	for _, current := range r.BookReports {
		if baselineBook, exists := baselineBooks[current.Name]; exists {
			bookDelta := WordbookDelta{
				Name:           current.Name,
				ScoreDelta:     current.AverageScore - baselineBook.AverageScore,
				CurrentScore:   current.AverageScore,
				BaselineScore:  baselineBook.AverageScore,
				CurrentStatus:  current.Status,
				BaselineStatus: baselineBook.Status,
				PassedDelta:    current.PassedWords - baselineBook.PassedWords,
				FailedDelta:    current.FailedWords - baselineBook.FailedWords,
			}
			delta.BookDeltas = append(delta.BookDeltas, bookDelta)
		} else {
			// New wordbook
			delta.BookDeltas = append(delta.BookDeltas, WordbookDelta{
				Name:          current.Name,
				ScoreDelta:    current.AverageScore,
				CurrentScore:  current.AverageScore,
				CurrentStatus: current.Status,
				IsNew:         true,
			})
		}
	}

	// Sort by absolute delta (biggest changes first)
	sort.Slice(delta.BookDeltas, func(i, j int) bool {
		return abs(delta.BookDeltas[i].ScoreDelta) > abs(delta.BookDeltas[j].ScoreDelta)
	})

	return delta
}

// QualityDelta represents the difference between two quality reports
type QualityDelta struct {
	Timestamp         time.Time       `json:"timestamp"`
	BaselineTimestamp time.Time       `json:"baseline_timestamp"`
	OverallDelta      float64         `json:"overall_delta"`
	BookDeltas        []WordbookDelta `json:"book_deltas"`
}

// WordbookDelta represents quality changes for a single wordbook
type WordbookDelta struct {
	Name           string  `json:"name"`
	ScoreDelta     float64 `json:"score_delta"`
	CurrentScore   float64 `json:"current_score"`
	BaselineScore  float64 `json:"baseline_score"`
	CurrentStatus  string  `json:"current_status"`
	BaselineStatus string  `json:"baseline_status"`
	PassedDelta    int     `json:"passed_delta"`
	FailedDelta    int     `json:"failed_delta"`
	IsNew          bool    `json:"is_new"`
}

// GenerateMarkdown generates a markdown summary of the quality delta
func (d *QualityDelta) GenerateMarkdown() string {
	var sb strings.Builder

	sb.WriteString("# Pipeline Quality Delta Report\n\n")
	fmt.Fprintf(&sb, "**Current:** %s\n", d.Timestamp.Format(time.RFC3339))
	fmt.Fprintf(&sb, "**Baseline:** %s\n\n", d.BaselineTimestamp.Format(time.RFC3339))

	// Overall change
	indicator := "⚪"
	if d.OverallDelta > 0.5 {
		indicator = "🟢"
	} else if d.OverallDelta < -0.5 {
		indicator = "🔴"
	}
	fmt.Fprintf(&sb, "## Overall Score Change: %s %.2f\n\n", indicator, d.OverallDelta)

	// Wordbook changes
	sb.WriteString("## Wordbook Changes\n\n")
	sb.WriteString("| Wordbook | Current Score | Delta | Status Change | Indicator |\n")
	sb.WriteString("|----------|---------------|-------|---------------|----------|\n")

	for _, book := range d.BookDeltas {
		deltaStr := fmt.Sprintf("%+.2f", book.ScoreDelta)
		statusChange := book.CurrentStatus
		if book.IsNew {
			statusChange = "NEW"
		} else if book.CurrentStatus != book.BaselineStatus {
			statusChange = fmt.Sprintf("%s → %s", book.BaselineStatus, book.CurrentStatus)
		}

		indicator := "⚪"
		if book.ScoreDelta > 1.0 {
			indicator = "🟢"
		} else if book.ScoreDelta < -1.0 {
			indicator = "🔴"
		}

		fmt.Fprintf(&sb, "| %s | %.2f | %s | %s | %s |\n",
			book.Name, book.CurrentScore, deltaStr, statusChange, indicator)
	}

	// Significant changes
	significantChanges := make([]WordbookDelta, 0)
	for _, book := range d.BookDeltas {
		if abs(book.ScoreDelta) > 2.0 || (book.CurrentStatus != book.BaselineStatus && !book.IsNew) {
			significantChanges = append(significantChanges, book)
		}
	}

	if len(significantChanges) > 0 {
		sb.WriteString("\n## Significant Changes (±2.0 or status change)\n\n")
		for _, book := range significantChanges {
			fmt.Fprintf(&sb, "### %s\n\n", book.Name)
			fmt.Fprintf(&sb, "- **Score:** %.2f → %.2f (%+.2f)\n", book.BaselineScore, book.CurrentScore, book.ScoreDelta)
			fmt.Fprintf(&sb, "- **Status:** %s → %s\n", book.BaselineStatus, book.CurrentStatus)
			if book.PassedDelta != 0 || book.FailedDelta != 0 {
				fmt.Fprintf(&sb, "- **Passed/Failed:** %+d / %+d\n", book.PassedDelta, book.FailedDelta)
			}
			sb.WriteString("\n")
		}
	}

	return sb.String()
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

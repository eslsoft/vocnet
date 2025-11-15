package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ImportReport contains the complete report for an import operation
type ImportReport struct {
	StageName   string            `json:"stage_name"`
	StartTime   time.Time         `json:"start_time"`
	EndTime     time.Time         `json:"end_time"`
	Duration    string            `json:"duration"`
	Statistics  Statistics        `json:"statistics"`
	Enrichment  *EnrichmentStats  `json:"enrichment,omitempty"`  // For ECDICT enrichment phase
	Samples     Samples           `json:"samples"`
	Issues      Issues            `json:"issues"`
}

// EnrichmentStats tracks the enrichment phase statistics
type EnrichmentStats struct {
	Attempted         int64            `json:"attempted"`           // Total words attempted to enrich
	Succeeded         int64            `json:"succeeded"`           // Successfully enriched
	Failed            int64            `json:"failed"`              // Failed to enrich
	NotFound          int64            `json:"not_found"`           // Word not found in database
	PhoneticsAdded    int64            `json:"phonetics_added"`     // How many phonetics were added
	DefinitionsAdded  int64            `json:"definitions_added"`   // How many definitions were added
	FormsAdded        int64            `json:"forms_added"`         // How many forms were added
	CategoriesAdded   int64            `json:"categories_added"`    // How many categories were added
}

// Statistics holds numerical data about the import
type Statistics struct {
	Total              int64            `json:"total"`
	Successful         int64            `json:"successful"`
	Failed             int64            `json:"failed"`
	Skipped            int64            `json:"skipped"`
	Updated            int64            `json:"updated,omitempty"`      // For enrichment stages
	NewlyAdded         int64            `json:"newly_added,omitempty"`  // For new word imports

	// Form-related statistics
	TotalForms         int64            `json:"total_forms,omitempty"`
	RegularForms       int64            `json:"regular_forms,omitempty"`
	IrregularForms     int64            `json:"irregular_forms,omitempty"`
	FormsAdded         int64            `json:"forms_added,omitempty"`

	// Form type breakdown
	FormsByType        map[string]int64 `json:"forms_by_type,omitempty"`

	// Data quality metrics
	WithPhonetics      int64            `json:"with_phonetics,omitempty"`
	WithDefinitions    int64            `json:"with_definitions,omitempty"`
	WithExchange       int64            `json:"with_exchange,omitempty"`
	WithCategories     int64            `json:"with_categories,omitempty"`
}

// Samples holds example entries from the import
type Samples struct {
	SuccessExamples []SampleEntry `json:"success_examples,omitempty"`
	FailureExamples []SampleEntry `json:"failure_examples,omitempty"`
	SkippedExamples []SampleEntry `json:"skipped_examples,omitempty"`
}

// SampleEntry represents a single sample from the import
type SampleEntry struct {
	Term        string   `json:"term"`
	Reason      string   `json:"reason,omitempty"`
	Details     string   `json:"details,omitempty"`
	Forms       []string `json:"forms,omitempty"`
	HasPhonetic bool     `json:"has_phonetic,omitempty"`
	HasExchange bool     `json:"has_exchange,omitempty"`
}

// Issues holds problems encountered during import
type Issues struct {
	MissingFields      map[string]int64 `json:"missing_fields,omitempty"`
	InvalidData        []IssueEntry     `json:"invalid_data,omitempty"`
	Duplicates         []IssueEntry     `json:"duplicates,omitempty"`
	ParseErrors        []IssueEntry     `json:"parse_errors,omitempty"`
	APIErrors          []IssueEntry     `json:"api_errors,omitempty"`
}

// IssueEntry represents a single issue
type IssueEntry struct {
	Term        string `json:"term"`
	Description string `json:"description"`
	Count       int64  `json:"count,omitempty"` // For aggregated issues
}

// NewImportReport creates a new report with the given stage name
func NewImportReport(stageName string) *ImportReport {
	return &ImportReport{
		StageName:  stageName,
		StartTime:  time.Now(),
		Statistics: Statistics{
			FormsByType:   make(map[string]int64),
		},
		Samples: Samples{
			SuccessExamples: make([]SampleEntry, 0),
			FailureExamples: make([]SampleEntry, 0),
			SkippedExamples: make([]SampleEntry, 0),
		},
		Issues: Issues{
			MissingFields: make(map[string]int64),
			InvalidData:   make([]IssueEntry, 0),
			Duplicates:    make([]IssueEntry, 0),
			ParseErrors:   make([]IssueEntry, 0),
			APIErrors:     make([]IssueEntry, 0),
		},
	}
}

// Finalize completes the report by setting the end time and duration
func (r *ImportReport) Finalize() {
	r.EndTime = time.Now()
	r.Duration = r.EndTime.Sub(r.StartTime).String()
}

// AddSuccessSample adds a success example (max 10)
func (r *ImportReport) AddSuccessSample(term string, forms []string, hasPhonetic, hasExchange bool) {
	if len(r.Samples.SuccessExamples) >= 10 {
		return
	}
	r.Samples.SuccessExamples = append(r.Samples.SuccessExamples, SampleEntry{
		Term:        term,
		Forms:       forms,
		HasPhonetic: hasPhonetic,
		HasExchange: hasExchange,
	})
}

// AddFailureSample adds a failure example (max 10)
func (r *ImportReport) AddFailureSample(term, reason, details string) {
	if len(r.Samples.FailureExamples) >= 10 {
		return
	}
	r.Samples.FailureExamples = append(r.Samples.FailureExamples, SampleEntry{
		Term:    term,
		Reason:  reason,
		Details: details,
	})
}

// AddSkippedSample adds a skipped example (max 10)
func (r *ImportReport) AddSkippedSample(term, reason string) {
	if len(r.Samples.SkippedExamples) >= 10 {
		return
	}
	r.Samples.SkippedExamples = append(r.Samples.SkippedExamples, SampleEntry{
		Term:   term,
		Reason: reason,
	})
}

// AddMissingField records a missing field
func (r *ImportReport) AddMissingField(fieldName string) {
	r.Issues.MissingFields[fieldName]++
}

// AddInvalidDataIssue adds an invalid data issue
func (r *ImportReport) AddInvalidDataIssue(term, description string) {
	if len(r.Issues.InvalidData) >= 50 {
		return
	}
	r.Issues.InvalidData = append(r.Issues.InvalidData, IssueEntry{
		Term:        term,
		Description: description,
	})
}

// AddDuplicateIssue adds a duplicate issue
func (r *ImportReport) AddDuplicateIssue(term, description string) {
	if len(r.Issues.Duplicates) >= 50 {
		return
	}
	r.Issues.Duplicates = append(r.Issues.Duplicates, IssueEntry{
		Term:        term,
		Description: description,
	})
}

// AddParseError adds a parse error
func (r *ImportReport) AddParseError(term, description string) {
	if len(r.Issues.ParseErrors) >= 50 {
		return
	}
	r.Issues.ParseErrors = append(r.Issues.ParseErrors, IssueEntry{
		Term:        term,
		Description: description,
	})
}

// AddAPIError adds an API error
func (r *ImportReport) AddAPIError(term, description string) {
	if len(r.Issues.APIErrors) >= 50 {
		return
	}
	r.Issues.APIErrors = append(r.Issues.APIErrors, IssueEntry{
		Term:        term,
		Description: description,
	})
}

// RecordFormType records a form type occurrence
func (r *ImportReport) RecordFormType(formType string) {
	r.Statistics.FormsByType[formType]++
}

// SaveToFile saves the report to a JSON file
func (r *ImportReport) SaveToFile(filename string) error {
	// Ensure the reports directory exists
	dir := filepath.Dir(filename)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create reports directory: %w", err)
	}

	// Marshal the report to JSON with indentation
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal report: %w", err)
	}

	// Write to file
	if err := os.WriteFile(filename, data, 0644); err != nil {
		return fmt.Errorf("failed to write report file: %w", err)
	}

	return nil
}

// PrintSummary prints a human-readable summary of the report
func (r *ImportReport) PrintSummary() {
	fmt.Println("\n" + strings.Repeat("=", 80))
	fmt.Printf("📊 %s Import Report\n", r.StageName)
	fmt.Println(strings.Repeat("=", 80))

	fmt.Printf("⏱️  Duration: %s\n", r.Duration)
	fmt.Printf("📝 Total Processed: %d\n", r.Statistics.Total)
	fmt.Printf("✅ Successful: %d\n", r.Statistics.Successful)

	if r.Statistics.Updated > 0 {
		fmt.Printf("🔄 Updated: %d\n", r.Statistics.Updated)
	}
	if r.Statistics.NewlyAdded > 0 {
		fmt.Printf("➕ Newly Added: %d\n", r.Statistics.NewlyAdded)
	}

	fmt.Printf("❌ Failed: %d\n", r.Statistics.Failed)
	fmt.Printf("⏭️  Skipped: %d\n", r.Statistics.Skipped)

	// Enrichment statistics
	if r.Enrichment != nil && r.Enrichment.Attempted > 0 {
		fmt.Println("\n🔧 Enrichment Phase:")
		fmt.Printf("  Attempted: %d\n", r.Enrichment.Attempted)
		fmt.Printf("  Succeeded: %d (%.1f%%)\n",
			r.Enrichment.Succeeded,
			float64(r.Enrichment.Succeeded)/float64(r.Enrichment.Attempted)*100)
		fmt.Printf("  Failed: %d\n", r.Enrichment.Failed)
		fmt.Printf("  Not Found: %d\n", r.Enrichment.NotFound)

		fmt.Println("\n  Data Added:")
		if r.Enrichment.PhoneticsAdded > 0 {
			fmt.Printf("    Phonetics: %d\n", r.Enrichment.PhoneticsAdded)
		}
		if r.Enrichment.DefinitionsAdded > 0 {
			fmt.Printf("    Definitions: %d\n", r.Enrichment.DefinitionsAdded)
		}
		if r.Enrichment.FormsAdded > 0 {
			fmt.Printf("    Forms: %d\n", r.Enrichment.FormsAdded)
		}
		if r.Enrichment.CategoriesAdded > 0 {
			fmt.Printf("    Categories: %d\n", r.Enrichment.CategoriesAdded)
		}
	}

	// Form statistics
	if r.Statistics.TotalForms > 0 {
		fmt.Println("\n📋 Form Statistics:")
		fmt.Printf("  Total Forms: %d\n", r.Statistics.TotalForms)
		fmt.Printf("  Regular Forms: %d (%.1f%%)\n",
			r.Statistics.RegularForms,
			float64(r.Statistics.RegularForms)/float64(r.Statistics.TotalForms)*100)
		fmt.Printf("  Irregular Forms: %d (%.1f%%)\n",
			r.Statistics.IrregularForms,
			float64(r.Statistics.IrregularForms)/float64(r.Statistics.TotalForms)*100)
	}

	// Form type breakdown
	if len(r.Statistics.FormsByType) > 0 {
		fmt.Println("\n📊 Forms by Type:")
		for formType, count := range r.Statistics.FormsByType {
			fmt.Printf("  %s: %d\n", formType, count)
		}
	}

	// Data quality
	if r.Statistics.Total > 0 {
		fmt.Println("\n📈 Data Quality:")
		if r.Statistics.WithPhonetics > 0 {
			fmt.Printf("  With Phonetics: %d (%.1f%%)\n",
				r.Statistics.WithPhonetics,
				float64(r.Statistics.WithPhonetics)/float64(r.Statistics.Total)*100)
		}
		if r.Statistics.WithDefinitions > 0 {
			fmt.Printf("  With Definitions: %d (%.1f%%)\n",
				r.Statistics.WithDefinitions,
				float64(r.Statistics.WithDefinitions)/float64(r.Statistics.Total)*100)
		}
		if r.Statistics.WithExchange > 0 {
			fmt.Printf("  With Exchange: %d (%.1f%%)\n",
				r.Statistics.WithExchange,
				float64(r.Statistics.WithExchange)/float64(r.Statistics.Total)*100)
		}
		if r.Statistics.WithCategories > 0 {
			fmt.Printf("  With Categories: %d (%.1f%%)\n",
				r.Statistics.WithCategories,
				float64(r.Statistics.WithCategories)/float64(r.Statistics.Total)*100)
		}
	}

	// Issues summary
	if len(r.Issues.MissingFields) > 0 {
		fmt.Println("\n⚠️  Missing Fields:")
		for field, count := range r.Issues.MissingFields {
			fmt.Printf("  %s: %d\n", field, count)
		}
	}

	if len(r.Issues.ParseErrors) > 0 {
		fmt.Printf("\n❗ Parse Errors: %d (see report file for details)\n", len(r.Issues.ParseErrors))
	}

	if len(r.Issues.APIErrors) > 0 {
		fmt.Printf("❗ API Errors: %d (see report file for details)\n", len(r.Issues.APIErrors))
	}

	if len(r.Issues.Duplicates) > 0 {
		fmt.Printf("❗ Duplicates: %d (see report file for details)\n", len(r.Issues.Duplicates))
	}

	fmt.Println(strings.Repeat("=", 80))
}

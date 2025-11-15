package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewImportReport(t *testing.T) {
	report := NewImportReport("TestStage")

	if report.StageName != "TestStage" {
		t.Errorf("StageName = %q, want %q", report.StageName, "TestStage")
	}

	if report.StartTime.IsZero() {
		t.Error("StartTime should be set")
	}

	if report.Statistics.FormsByType == nil {
		t.Error("FormsByType map should be initialized")
	}

	if report.Issues.MissingFields == nil {
		t.Error("MissingFields map should be initialized")
	}
}

func TestImportReport_Finalize(t *testing.T) {
	report := NewImportReport("TestStage")
	time.Sleep(10 * time.Millisecond)
	report.Finalize()

	if report.EndTime.IsZero() {
		t.Error("EndTime should be set after Finalize")
	}

	if report.Duration == "" {
		t.Error("Duration should be set after Finalize")
	}

	if !report.EndTime.After(report.StartTime) {
		t.Error("EndTime should be after StartTime")
	}
}

func TestImportReport_AddSamples(t *testing.T) {
	report := NewImportReport("TestStage")

	// Add success samples
	for i := 0; i < 15; i++ {
		report.AddSuccessSample("word"+string(rune('a'+i)), []string{"form1", "form2"}, true, true)
	}

	// Should only keep 10
	if len(report.Samples.SuccessExamples) != 10 {
		t.Errorf("SuccessExamples length = %d, want 10", len(report.Samples.SuccessExamples))
	}

	// Add failure samples
	for i := 0; i < 15; i++ {
		report.AddFailureSample("word"+string(rune('a'+i)), "test reason", "test details")
	}

	if len(report.Samples.FailureExamples) != 10 {
		t.Errorf("FailureExamples length = %d, want 10", len(report.Samples.FailureExamples))
	}

	// Add skipped samples
	for i := 0; i < 15; i++ {
		report.AddSkippedSample("word"+string(rune('a'+i)), "test reason")
	}

	if len(report.Samples.SkippedExamples) != 10 {
		t.Errorf("SkippedExamples length = %d, want 10", len(report.Samples.SkippedExamples))
	}
}

func TestImportReport_AddIssues(t *testing.T) {
	report := NewImportReport("TestStage")

	// Add missing fields
	report.AddMissingField("phonetic")
	report.AddMissingField("phonetic")
	report.AddMissingField("definition")

	if report.Issues.MissingFields["phonetic"] != 2 {
		t.Errorf("MissingFields[phonetic] = %d, want 2", report.Issues.MissingFields["phonetic"])
	}

	if report.Issues.MissingFields["definition"] != 1 {
		t.Errorf("MissingFields[definition] = %d, want 1", report.Issues.MissingFields["definition"])
	}

	// Add invalid data issues (max 50)
	for i := 0; i < 60; i++ {
		report.AddInvalidDataIssue("word", "test issue")
	}

	if len(report.Issues.InvalidData) != 50 {
		t.Errorf("InvalidData length = %d, want 50", len(report.Issues.InvalidData))
	}

	// Add parse errors (max 50)
	for i := 0; i < 60; i++ {
		report.AddParseError("word", "parse error")
	}

	if len(report.Issues.ParseErrors) != 50 {
		t.Errorf("ParseErrors length = %d, want 50", len(report.Issues.ParseErrors))
	}
}

func TestImportReport_RecordFormType(t *testing.T) {
	report := NewImportReport("TestStage")

	report.RecordFormType("PLURAL")
	report.RecordFormType("PLURAL")
	report.RecordFormType("PAST")

	if report.Statistics.FormsByType["PLURAL"] != 2 {
		t.Errorf("FormsByType[PLURAL] = %d, want 2", report.Statistics.FormsByType["PLURAL"])
	}

	if report.Statistics.FormsByType["PAST"] != 1 {
		t.Errorf("FormsByType[PAST] = %d, want 1", report.Statistics.FormsByType["PAST"])
	}
}

func TestImportReport_SaveToFile(t *testing.T) {
	report := NewImportReport("TestStage")
	report.Statistics.Total = 100
	report.Statistics.Successful = 90
	report.Statistics.Failed = 5
	report.Statistics.Skipped = 5
	report.AddSuccessSample("test", []string{"tests"}, true, true)
	report.AddMissingField("phonetic")
	report.Finalize()

	// Create temp directory
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "reports", "test_report.json")

	// Save report
	if err := report.SaveToFile(filename); err != nil {
		t.Fatalf("SaveToFile failed: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Fatalf("Report file was not created")
	}

	// Read and parse file
	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("Failed to read report file: %v", err)
	}

	var loadedReport ImportReport
	if err := json.Unmarshal(data, &loadedReport); err != nil {
		t.Fatalf("Failed to parse report JSON: %v", err)
	}

	// Verify content
	if loadedReport.StageName != "TestStage" {
		t.Errorf("Loaded StageName = %q, want %q", loadedReport.StageName, "TestStage")
	}

	if loadedReport.Statistics.Total != 100 {
		t.Errorf("Loaded Total = %d, want 100", loadedReport.Statistics.Total)
	}

	if loadedReport.Statistics.Successful != 90 {
		t.Errorf("Loaded Successful = %d, want 90", loadedReport.Statistics.Successful)
	}

	if loadedReport.Issues.MissingFields["phonetic"] != 1 {
		t.Errorf("Loaded MissingFields[phonetic] = %d, want 1",
			loadedReport.Issues.MissingFields["phonetic"])
	}
}

func TestImportReport_PrintSummary(t *testing.T) {
	report := NewImportReport("TestStage")
	report.Statistics.Total = 1000
	report.Statistics.Successful = 900
	report.Statistics.Failed = 50
	report.Statistics.Skipped = 50
	report.Statistics.TotalForms = 2000
	report.Statistics.RegularForms = 1800
	report.Statistics.IrregularForms = 200
	report.Statistics.WithPhonetics = 950
	report.RecordFormType("PLURAL")
	report.RecordFormType("PAST")
	report.AddMissingField("phonetic")
	report.AddMissingField("phonetic")
	report.AddParseError("word1", "error1")
	report.Finalize()

	// This should not panic
	// We can't easily test the output without capturing stdout, but we can at least verify it runs
	report.PrintSummary()
}

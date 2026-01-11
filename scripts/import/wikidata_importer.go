package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/schollz/progressbar/v3"
)

type wikidataImporter struct {
	importService *LexemeImportService
	filePath      string
	limit         int
	batchSize     int
	report        *ImportReport
	reportMu      sync.Mutex
	importedWords []string
	importedMu    sync.Mutex
}

func newWikidataImporter(cfg pipelineConfig, importService *LexemeImportService) *wikidataImporter {
	return &wikidataImporter{
		importService: importService,
		filePath:      cfg.wikidataFile,
		limit:         cfg.wikidataLimit,
		batchSize:     cfg.batchSize,
		report:        NewImportReport("Wikidata"),
	}
}

func (imp *wikidataImporter) Name() string {
	return "wikidata"
}

func (imp *wikidataImporter) Run(ctx context.Context) (*ImportReport, error) {
	log.Println("[wikidata] Starting Wikidata import using repository layer")

	lexemes, err := imp.loadLexemes()
	if err != nil {
		return imp.report, err
	}
	if len(lexemes) == 0 {
		log.Printf("[wikidata] no lexemes found in %s", imp.filePath)
		imp.report.Finalize()
		return imp.report, nil
	}

	imp.report.Statistics.Total = int64(len(lexemes))

	// Create progress bar
	bar := progressbar.NewOptions(len(lexemes),
		progressbar.OptionSetDescription("📚 Wikidata"),
		progressbar.OptionSetWidth(40),
		progressbar.OptionShowCount(),
		progressbar.OptionShowIts(),
		progressbar.OptionSetTheme(progressbar.Theme{
			Saucer:        "=",
			SaucerHead:    ">",
			SaucerPadding: " ",
			BarStart:      "[",
			BarEnd:        "]",
		}),
		progressbar.OptionThrottle(100*time.Millisecond),
		progressbar.OptionClearOnFinish(),
	)

	jobCh := make(chan WikidataLexeme, imp.batchSize*2)
	resultCh := make(chan importResult, imp.batchSize*2)
	var wg sync.WaitGroup

	var succeeded, failed, skipped int64

	// Start workers
	for i := 0; i < imp.batchSize; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for wdLexeme := range jobCh {
				result := imp.importLexeme(ctx, wdLexeme)
				resultCh <- result
			}
		}(i + 1)
	}

	// Result collector
	var collectorWg sync.WaitGroup
	collectorWg.Add(1)
	go func() {
		defer collectorWg.Done()
		for result := range resultCh {
			bar.Add(1)

			if result.err != nil {
				atomic.AddInt64(&failed, 1)
				imp.reportMu.Lock()
				imp.report.AddFailureSample(result.lemma, "import_error", result.err.Error())
				imp.reportMu.Unlock()
				log.Printf("[wikidata] failed to import %s (%s): %v", result.id, result.lemma, result.err)
				Warn("[wikidata] failed to import %s: %v", result.lemma, result.err)
			} else if result.skipped {
				atomic.AddInt64(&skipped, 1)
				imp.reportMu.Lock()
				imp.report.Statistics.Skipped++
				imp.report.AddSkippedSample(result.id, result.skipReason)
				imp.reportMu.Unlock()
			} else {
				atomic.AddInt64(&succeeded, 1)

				imp.reportMu.Lock()
				// Record success
				imp.report.AddSuccessSample(result.lemma, result.forms, result.hasPhonetic, false)

				// Record form statistics
				imp.report.Statistics.TotalForms += int64(result.formCount)
				imp.report.Statistics.IrregularForms += int64(result.irregularCount)
				imp.report.Statistics.RegularForms += int64(result.formCount - result.irregularCount)

				// Record data quality
				if result.hasPhonetic {
					imp.report.Statistics.WithPhonetics++
				}
				if result.hasDefinitions {
					imp.report.Statistics.WithDefinitions++
				}
				if result.hasCategories {
					imp.report.Statistics.WithCategories++
				}
				imp.reportMu.Unlock()

				// Record imported words
				imp.recordImportedWord(result.lemma, result.forms)
			}
		}
	}()

	// Process lexemes
	for _, wdLexeme := range lexemes {
		jobCh <- wdLexeme
	}

	close(jobCh)
	wg.Wait()
	close(resultCh)
	collectorWg.Wait()
	bar.Finish()

	// Update final statistics
	imp.report.Statistics.Successful = succeeded
	imp.report.Statistics.Failed = failed

	log.Printf("[wikidata] done. succeeded=%d skipped=%d failed=%d total=%d",
		succeeded, skipped, failed, len(lexemes))

	fmt.Printf("✓ Wikidata: %d succeeded, %d skipped, %d failed (total: %d)\n",
		succeeded, skipped, failed, len(lexemes))

	// Finalize report
	imp.report.Finalize()
	imp.report.PrintSummary()

	// Save report
	reportPath := "reports/wikidata_import_report.json"
	if err := imp.report.SaveToFile(reportPath); err != nil {
		log.Printf("[wikidata] Warning: failed to save report to %s: %v", reportPath, err)
		Warn("[wikidata] Failed to save report: %v", err)
	} else {
		log.Printf("[wikidata] Report saved to %s", reportPath)
	}

	if failed > 0 {
		Warn("Wikidata stage encountered %d failures", failed)
		return imp.report, fmt.Errorf("wikidata stage encountered %d failures", failed)
	}
	return imp.report, nil
}

type importResult struct {
	id             string
	lemma          string
	forms          []string
	formCount      int
	irregularCount int
	hasPhonetic    bool
	hasDefinitions bool
	hasCategories  bool
	skipped        bool
	skipReason     string
	err            error
}

func (imp *wikidataImporter) importLexeme(ctx context.Context, wdLexeme WikidataLexeme) importResult {
	result := importResult{
		id: wdLexeme.ID,
	}

	// Build entity from Wikidata JSON
	importData, err := BuildWikidataLexeme(wdLexeme)
	if err != nil {
		result.skipped = true
		result.skipReason = err.Error()
		return result
	}

	result.lemma = importData.Lemmas[0].Surface

	// Import using import service
	err = imp.importService.CreateOrUpdateComplete(ctx, importData)
	if err != nil {
		result.err = err
		return result
	}

	// Collect statistics
	for _, lemmaData := range importData.Lemmas {
		for _, form := range lemmaData.Forms {
			result.forms = append(result.forms, form.Surface)
			result.formCount++
			if form.IsIrregular {
				result.irregularCount++
			}
			if len(form.Phonetics) > 0 {
				result.hasPhonetic = true
			}
		}
	}

	result.hasDefinitions = len(importData.Lexeme.Senses) > 0
	result.hasCategories = len(importData.Lexeme.Categories) > 0

	return result
}

func (imp *wikidataImporter) loadLexemes() ([]WikidataLexeme, error) {
	path, err := expandHome(imp.filePath)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read wikidata file: %w", err)
	}
	var lexemes []WikidataLexeme
	if err := json.Unmarshal(data, &lexemes); err != nil {
		return nil, fmt.Errorf("parse wikidata json: %w", err)
	}
	if imp.limit > 0 && len(lexemes) > imp.limit {
		lexemes = lexemes[:imp.limit]
	}
	return lexemes, nil
}

func (imp *wikidataImporter) GetImportedWords() []string {
	imp.importedMu.Lock()
	defer imp.importedMu.Unlock()

	result := make([]string, len(imp.importedWords))
	copy(result, imp.importedWords)
	return result
}

func (imp *wikidataImporter) recordImportedWord(lemma string, forms []string) {
	imp.importedMu.Lock()
	defer imp.importedMu.Unlock()

	imp.importedWords = append(imp.importedWords, lemma)
	imp.importedWords = append(imp.importedWords, forms...)
}

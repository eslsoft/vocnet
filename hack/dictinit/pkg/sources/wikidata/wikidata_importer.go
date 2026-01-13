package wikidata

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	"github.com/schollz/progressbar/v3"
)

type Importer struct {
	importService *store.LexemeImportService
	filePath      string
	limit         int
	batchSize     int
	report        *report.ImportReport
}

func NewImporter(filePath string, limit, batchSize int, importService *store.LexemeImportService) *Importer {
	return &Importer{
		importService: importService,
		filePath:      filePath,
		limit:         limit,
		batchSize:     batchSize,
		report:        report.NewImportReport("Wikidata"),
	}
}

func (imp *Importer) Name() string {
	return "wikidata"
}

func (imp *Importer) Run(ctx context.Context) (*report.ImportReport, error) {
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
	progressCh := make(chan struct{}, imp.batchSize*4)
	statsCh := make(chan wikidataWorkerStats, imp.batchSize)
	var wg sync.WaitGroup

	progressDone := make(chan struct{})
	go func() {
		defer close(progressDone)
		for range progressCh {
			bar.Add(1)
		}
	}()

	// Start workers
	for i := 0; i < imp.batchSize; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			stats := newWikidataWorkerStats()
			for wdLexeme := range jobCh {
				result := imp.importLexeme(ctx, wdLexeme)
				stats.applyResult(result)
				progressCh <- struct{}{}
			}
			statsCh <- stats
		}(i + 1)
	}

	// Process lexemes
	for _, wdLexeme := range lexemes {
		jobCh <- wdLexeme
	}

	close(jobCh)
	wg.Wait()
	close(progressCh)
	<-progressDone
	close(statsCh)
	bar.Finish()

	aggregate := newWikidataWorkerStats()
	for stats := range statsCh {
		aggregate.merge(stats)
	}

	// Update final statistics
	imp.report.Statistics.Successful = aggregate.succeeded
	imp.report.Statistics.Failed = aggregate.failed
	imp.report.Statistics.Skipped = aggregate.skipped
	imp.report.Statistics.TotalForms = aggregate.totalForms
	imp.report.Statistics.IrregularForms = aggregate.irregularForms
	imp.report.Statistics.RegularForms = aggregate.regularForms
	imp.report.Statistics.TotalRelations = aggregate.totalRelations
	imp.report.Statistics.TotalCategories = aggregate.totalCategories
	imp.report.Statistics.WithPhonetics = aggregate.withPhonetics
	imp.report.Statistics.WithDefinitions = aggregate.withDefinitions
	imp.report.Samples.SuccessExamples = aggregate.successSamples
	imp.report.Samples.FailureExamples = aggregate.failureSamples
	imp.report.Samples.SkippedExamples = aggregate.skippedSamples

	imp.report.Statistics.RelationsByType = make(map[string]int64)
	for idx, count := range aggregate.relationTypeCounts {
		if count == 0 {
			continue
		}
		imp.report.Statistics.RelationsByType[fmt.Sprintf("%d", idx)] = count
	}

	// Update final statistics
	log.Printf("[wikidata] done. succeeded=%d skipped=%d failed=%d total=%d",
		aggregate.succeeded, aggregate.skipped, aggregate.failed, len(lexemes))

	fmt.Printf("✓ Wikidata: %d succeeded, %d skipped, %d failed (total: %d)\n",
		aggregate.succeeded, aggregate.skipped, aggregate.failed, len(lexemes))

	// Finalize report
	imp.report.Finalize()
	imp.report.PrintSummary()

	// Save report
	reportPath := "reports/wikidata_import_report.json"
	if err := imp.report.SaveToFile(reportPath); err != nil {
		log.Printf("[wikidata] Warning: failed to save report to %s: %v", reportPath, err)
		util.Warn("[wikidata] Failed to save report: %v", err)
	} else {
		log.Printf("[wikidata] Report saved to %s", reportPath)
	}

	if aggregate.failed > 0 {
		util.Warn("Wikidata stage encountered %d failures", aggregate.failed)
		return imp.report, fmt.Errorf("wikidata stage encountered %d failures", aggregate.failed)
	}
	return imp.report, nil
}

type importResult struct {
	id              string
	lemma           string
	forms           []string
	formCount       int
	irregularCount  int
	hasPhonetic     bool
	hasDefinitions  bool
	hasCategories   bool
	categoriesCount int
	relationsCount  int
	relationTypes   []int64
	skipped         bool
	skipReason      string
	err             error
}

func (imp *Importer) importLexeme(ctx context.Context, wdLexeme WikidataLexeme) importResult {
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
	result.categoriesCount = len(importData.Lexeme.Categories)
	if len(importData.Lexeme.Relations) > 0 {
		result.relationsCount = len(importData.Lexeme.Relations)
		result.relationTypes = make([]int64, relationTypeCountSize)
		for _, rel := range importData.Lexeme.Relations {
			idx := int(rel.RelationType)
			if idx < 0 {
				continue
			}
			if idx >= len(result.relationTypes) {
				expanded := make([]int64, idx+1)
				copy(expanded, result.relationTypes)
				result.relationTypes = expanded
			}
			result.relationTypes[idx]++
		}
	}

	return result
}

func (imp *Importer) loadLexemes() ([]WikidataLexeme, error) {
	path, err := util.ExpandHome(imp.filePath)
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

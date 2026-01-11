package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/schollz/progressbar/v3"
)

type ecdictImporter struct {
	importService *LexemeImportService
	enricher      *ecdictEnricher
	batchSize     int
	report        *ImportReport
	reportMu      sync.Mutex
}

func newECDictImporter(cfg pipelineConfig, importService *LexemeImportService, enricher *ecdictEnricher) *ecdictImporter {
	return &ecdictImporter{
		importService: importService,
		enricher:      enricher,
		batchSize:     cfg.batchSize,
		report:        NewImportReport("ECDICT"),
	}
}

func (imp *ecdictImporter) Name() string {
	return "ecdict"
}

func (imp *ecdictImporter) Run(ctx context.Context) (*ImportReport, error) {
	if imp.enricher == nil {
		return nil, fmt.Errorf("ecdict enricher not initialized")
	}

	log.Println("[ecdict] Starting ECDICT import using import service")

	// Phase 1: Get words to process from enricher (only new words)
	log.Println("[ecdict] Extracting words from ECDICT...")
	wordsToImport, wordsToEnrich, skipped := imp.getWordsToProcess()
	log.Printf("[ecdict] Found %d new words to create, %d words to enrich, %d skipped",
		len(wordsToImport), len(wordsToEnrich), len(skipped))

	// Update statistics for skipped words
	for _, skip := range skipped {
		imp.report.Statistics.Skipped++
		imp.report.AddSkippedSample(skip.word, skip.reason)

		// Track missing fields
		switch skip.reason {
		case "no_exchange":
			imp.report.AddMissingField("exchange")
		case "no_phonetic":
			imp.report.AddMissingField("phonetic")
		case "no_useful_data":
			imp.report.AddMissingField("useful_data")
		}
	}

	if len(wordsToImport) == 0 {
		log.Println("[ecdict] No words to import")
		imp.report.Finalize()
		return imp.report, nil
	}

	imp.report.Statistics.Total = int64(len(wordsToImport))

	// Create progress bar
	bar := progressbar.NewOptions(len(wordsToImport),
		progressbar.OptionSetDescription("📖 ECDICT"),
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

	jobCh := make(chan ecdictWord, imp.batchSize*2)
	resultCh := make(chan ecdictImportResult, imp.batchSize*2)
	var wg sync.WaitGroup

	var succeeded, failed int64

	// Start workers
	for i := 0; i < imp.batchSize; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for word := range jobCh {
				result := imp.importWord(ctx, word)
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
				imp.report.AddFailureSample(result.word, "import_error", result.err.Error())
				imp.reportMu.Unlock()
				log.Printf("[ecdict] failed to import %s: %v", result.word, result.err)
				Warn("[ecdict] failed to import %s: %v", result.word, result.err)
			} else {
				atomic.AddInt64(&succeeded, 1)

				imp.reportMu.Lock()
				// Record success
				imp.report.AddSuccessSample(result.word, result.forms, result.hasPhonetic, result.hasExchange)

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
				if result.hasExchange {
					imp.report.Statistics.WithExchange++
				}
				imp.reportMu.Unlock()
			}
		}
	}()

	// Send words to workers
	for _, word := range wordsToImport {
		jobCh <- word
	}
	close(jobCh)

	wg.Wait()
	close(resultCh)
	collectorWg.Wait()
	bar.Finish()

	// Update final statistics
	imp.report.Statistics.Successful = succeeded
	imp.report.Statistics.Failed = failed
	imp.report.Statistics.NewlyAdded = succeeded

	log.Printf("[ecdict] Phase 1 done. succeeded=%d failed=%d", succeeded, failed)
	fmt.Printf("✓ ECDICT Import: %d succeeded, %d failed\n", succeeded, failed)

	// Finalize report
	imp.report.Finalize()
	imp.report.PrintSummary()

	// Save report
	reportPath := "reports/ecdict_import_report.json"
	if err := imp.report.SaveToFile(reportPath); err != nil {
		log.Printf("[ecdict] Warning: failed to save report to %s: %v", reportPath, err)
		Warn("[ecdict] Failed to save report: %v", err)
	} else {
		log.Printf("[ecdict] Report saved to %s", reportPath)
	}

	// Phase 2: Enrich existing words
	if len(wordsToEnrich) > 0 {
		log.Println("\n" + strings.Repeat("=", 80))
		log.Println("Phase 2: Enriching Existing Words with ECDICT Data")
		log.Println(strings.Repeat("=", 80))

		enricher := newECDictEnrichmentImporter(pipelineConfig{batchSize: imp.batchSize}, imp.importService)
		enrichReport, err := enricher.Run(ctx, wordsToEnrich)
		if err != nil {
			log.Printf("[ecdict-enrich] Warning: enrichment had errors: %v", err)
		}
		_ = enrichReport // Report is saved by enricher
	}

	return imp.report, nil
}

type ecdictWord struct {
	word       string
	enrichment *ecdictEnrichment
}

type ecdictImportResult struct {
	word           string
	forms          []string
	formCount      int
	irregularCount int
	hasPhonetic    bool
	hasDefinitions bool
	hasExchange    bool
	err            error
}

func (imp *ecdictImporter) getWordsToProcess() ([]ecdictWord, []ecdictWord, []skippedWordEntry) {
	imp.enricher.mu.Lock()
	defer imp.enricher.mu.Unlock()

	var wordsToImport []ecdictWord    // New words to create
	var wordsToEnrich []ecdictWord    // Existing words to enrich
	var skipped []skippedWordEntry

	for word, enrichment := range imp.enricher.entries {
		// Check if has useful data
		hasUsefulData := len(enrichment.phonetics) > 0 || len(enrichment.senses) > 0
		hasExchange := enrichment.exchange != ""

		if !hasUsefulData {
			skipped = append(skipped, skippedWordEntry{
				word:        word,
				reason:      "no_useful_data",
				translation: enrichment.translation,
				exchange:    enrichment.exchange,
			})
			continue
		}

		// Determine if this is an inflected form by checking exchange field
		isInflectedForm := false
		if hasExchange {
			lemma, _ := parseExchange(word, enrichment.exchange)
			// If exchange contains "0:xxx" pointing to a different word, it's an inflected form
			if lemma != "" && !strings.EqualFold(lemma, word) {
				isInflectedForm = true
			}
		}

		// Check if word exists in Wikidata
		if imp.enricher.knownForms[word] {
			// Word exists: add to enrichment list (even if it's an inflected form)
			wordsToEnrich = append(wordsToEnrich, ecdictWord{
				word:       word,
				enrichment: enrichment,
			})
		} else {
			// Word doesn't exist in database
			if isInflectedForm {
				// Inflected form not in database: skip (don't create new words for inflected forms)
				skipped = append(skipped, skippedWordEntry{
					word:        word,
					reason:      "inflected_form",
					translation: enrichment.translation,
					exchange:    enrichment.exchange,
				})
				continue
			}

			if !hasExchange {
				// No exchange: can't create new word, skip
				skipped = append(skipped, skippedWordEntry{
					word:        word,
					reason:      "no_exchange",
					translation: enrichment.translation,
					exchange:    enrichment.exchange,
				})
				continue
			}

			// Lemma with exchange: create new word
			wordsToImport = append(wordsToImport, ecdictWord{
				word:       word,
				enrichment: enrichment,
			})
		}
	}

	return wordsToImport, wordsToEnrich, skipped
}

func (imp *ecdictImporter) importWord(ctx context.Context, word ecdictWord) ecdictImportResult {
	result := ecdictImportResult{
		word: word.word,
	}

	// Build entity from ECDICT data
	importData, err := BuildECDictLexeme(word.word, word.enrichment)
	if err != nil || importData == nil {
		result.err = fmt.Errorf("build failed: %w", err)
		return result
	}

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
	result.hasExchange = word.enrichment.exchange != ""

	return result
}

package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
	"github.com/schollz/progressbar/v3"
)

type ecdictStage struct {
	enricher       *ecdictEnricher
	batchSize      int
	requestTimeout time.Duration
	report         *ImportReport
	reportMu       sync.Mutex // Protects concurrent access to report
}

func newECDictStage(cfg pipelineConfig, enricher *ecdictEnricher) *ecdictStage {
	return &ecdictStage{
		enricher:       enricher,
		batchSize:      cfg.batchSize,
		requestTimeout: cfg.requestTimeout,
		report:         NewImportReport("ECDICT"),
	}
}

func (s *ecdictStage) Name() string { return "ecdict" }

// Run executes the ECDICT import stage with two sub-phases:
// 1. Enrich existing words with ECDICT data (phonetics, definitions)
// 2. Import new words from ECDICT that weren't in Wikidata (must have exchange)
func (s *ecdictStage) Run(ctx context.Context, client dictv1connect.DictServiceClient) (*ImportReport, error) {
	if s.enricher == nil {
		return nil, fmt.Errorf("ecdict enricher not initialized")
	}

	log.Println("[ecdict] Starting ECDICT import stage")

	// Phase 1: Get words to process (new words + enrichment candidates)
	log.Println("[ecdict] Phase 1: Extracting words from ECDICT...")
	newWords, enrichmentWords, skipped := s.enricher.GetWordsToProcess()
	log.Printf("[ecdict] Found %d new words to create, %d words to enrich, %d skipped",
		len(newWords), len(enrichmentWords), len(skipped))

	// Update statistics for skipped words
	for _, skip := range skipped {
		s.report.Statistics.Skipped++
		s.report.AddSkippedSample(skip.word, skip.reason)

		// Track missing fields
		switch skip.reason {
		case "no_exchange":
			s.report.AddMissingField("exchange")
		case "no_phonetic":
			s.report.AddMissingField("phonetic")
		}
	}

	// Phase 2: Enrich existing words (even without exchange)
	if len(enrichmentWords) > 0 {
		log.Printf("[ecdict] Phase 2: Enriching %d existing words...", len(enrichmentWords))
		fmt.Printf("\n")

		// Initialize enrichment statistics
		s.report.Enrichment = &EnrichmentStats{
			Attempted: int64(len(enrichmentWords)),
		}

		if err := s.enrichExistingWords(ctx, client, enrichmentWords); err != nil {
			log.Printf("[ecdict] Warning: enrichment phase had errors: %v", err)
			Warn("[ecdict] Enrichment phase had errors: %v", err)
		}
	}

	// Phase 3: Import new words (must have exchange)
	if len(newWords) > 0 {
		log.Printf("[ecdict] Phase 3: Importing %d new words...", len(newWords))
		fmt.Printf("\n")
		if err := s.importNewWords(ctx, client, newWords); err != nil {
			return s.report, fmt.Errorf("failed to import new words: %w", err)
		}
	}

	// Finalize report
	s.report.Finalize()

	// Print summary
	s.report.PrintSummary()

	// Save report to file
	reportPath := "reports/ecdict_import_report.json"
	if err := s.report.SaveToFile(reportPath); err != nil {
		log.Printf("[ecdict] Warning: failed to save report to %s: %v", reportPath, err)
	} else {
		log.Printf("[ecdict] Report saved to %s", reportPath)
	}

	return s.report, nil
}

// importNewWords imports new words from ECDICT into the database
func (s *ecdictStage) importNewWords(ctx context.Context, client dictv1connect.DictServiceClient, words []*dictv1.Word) error {
	// Create progress bar
	bar := progressbar.NewOptions(len(words),
		progressbar.OptionSetDescription("📖 Importing"),
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

	jobCh := make(chan *dictv1.Word, s.batchSize*2)
	var wg sync.WaitGroup

	var succeeded, failed int64

	// Start worker pool
	for i := 0; i < s.batchSize; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for word := range jobCh {
				reqCtx, cancel := context.WithTimeout(ctx, s.requestTimeout)
				err := s.createOrUpdateWord(reqCtx, client, word)
				cancel()

				bar.Add(1)

				if err != nil {
					atomic.AddInt64(&failed, 1)
					s.reportMu.Lock()
					s.report.AddFailureSample(word.Term, "api_error", err.Error())
					s.report.AddAPIError(word.Term, err.Error())
					s.reportMu.Unlock()
					log.Printf("[ecdict] worker %d failed to create %s: %v", workerID, word.Term, err)
					Warn("[ecdict] Failed to import %s: %v", word.Term, err)
				} else {
					atomic.AddInt64(&succeeded, 1)

					// Add success sample (first 10 only)
					formStrs := make([]string, 0, len(word.RelatedForms))
					for _, form := range word.RelatedForms {
						formStrs = append(formStrs, form.Term)
					}
					hasPhonetic := len(word.Phonetics) > 0

					s.reportMu.Lock()
					// For ECDICT words, exchange is always present (we filter by it)
					s.report.AddSuccessSample(word.Term, formStrs, hasPhonetic, true)

					// Record form statistics
					for _, form := range word.RelatedForms {
						s.report.Statistics.TotalForms++
						if form.Irregular {
							s.report.Statistics.IrregularForms++
						} else {
							s.report.Statistics.RegularForms++
						}
						s.report.RecordFormType(form.FormType.String())
					}
					s.reportMu.Unlock()
				}
			}
		}(i + 1)
	}

	// Send words to workers
	s.report.Statistics.Total = int64(len(words))
	for _, word := range words {
		jobCh <- word
	}
	close(jobCh)

	// Wait for all workers to finish
	wg.Wait()
	bar.Finish()

	// Update final statistics
	s.report.Statistics.Successful = succeeded
	s.report.Statistics.Failed = failed
	s.report.Statistics.NewlyAdded = succeeded

	// Data quality metrics
	for _, word := range words {
		if len(word.Phonetics) > 0 {
			s.report.Statistics.WithPhonetics++
		}
		if len(word.Meanings) > 0 {
			s.report.Statistics.WithDefinitions++
		}
		if len(word.RelatedForms) > 0 {
			s.report.Statistics.WithExchange++
		}
		if len(word.Categories) > 0 {
			s.report.Statistics.WithCategories++
		}
	}

	log.Printf("[ecdict] Import complete: %d succeeded, %d failed", succeeded, failed)
	fmt.Printf("✓ Import: %d succeeded, %d failed\n", succeeded, failed)
	return nil
}

// enrichExistingWords enriches existing words with ECDICT data (phonetics, definitions, etc.)
func (s *ecdictStage) enrichExistingWords(ctx context.Context, client dictv1connect.DictServiceClient, words []*dictv1.Word) error {
	// Create progress bar
	bar := progressbar.NewOptions(len(words),
		progressbar.OptionSetDescription("🔧 Enriching"),
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

	jobCh := make(chan *dictv1.Word, s.batchSize*2)
	var wg sync.WaitGroup

	var succeeded, failed int64

	var notFound int64
	var totalPhoneticsAdded, totalDefinitionsAdded, totalFormsAdded, totalCategoriesAdded int64

	// Start worker pool
	for i := 0; i < s.batchSize; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for word := range jobCh {
				reqCtx, cancel := context.WithTimeout(ctx, s.requestTimeout)
				result, err := s.enrichWord(reqCtx, client, word)
				cancel()

				bar.Add(1)

				if err != nil {
					atomic.AddInt64(&failed, 1)
					log.Printf("[ecdict] worker %d failed to enrich %s: %v", workerID, word.Term, err)
					Warn("[ecdict] Failed to enrich %s: %v", word.Term, err)
				} else if result != nil {
					if result.notFound {
						atomic.AddInt64(&notFound, 1)
					} else if result.succeeded {
						atomic.AddInt64(&succeeded, 1)

						// Track what was added
						atomic.AddInt64(&totalPhoneticsAdded, int64(result.phoneticsAdded))
						atomic.AddInt64(&totalDefinitionsAdded, int64(result.definitionsAdded))
						atomic.AddInt64(&totalFormsAdded, int64(result.formsAdded))
						atomic.AddInt64(&totalCategoriesAdded, int64(result.categoriesAdded))
					}
				}
			}
		}(i + 1)
	}

	// Send words to workers
	for _, word := range words {
		jobCh <- word
	}
	close(jobCh)

	// Wait for all workers to finish
	wg.Wait()
	bar.Finish()

	// Update enrichment statistics in report
	s.reportMu.Lock()
	s.report.Enrichment.Succeeded = succeeded
	s.report.Enrichment.Failed = failed
	s.report.Enrichment.NotFound = notFound
	s.report.Enrichment.PhoneticsAdded = totalPhoneticsAdded
	s.report.Enrichment.DefinitionsAdded = totalDefinitionsAdded
	s.report.Enrichment.FormsAdded = totalFormsAdded
	s.report.Enrichment.CategoriesAdded = totalCategoriesAdded
	s.reportMu.Unlock()

	log.Printf("[ecdict] Enrichment complete: %d succeeded, %d failed, %d not found", succeeded, failed, notFound)
	fmt.Printf("✓ Enrichment: %d succeeded, %d failed, %d not found\n", succeeded, failed, notFound)
	return nil
}

// enrichmentResult tracks what was added during enrichment
type enrichmentResult struct {
	succeeded        bool
	notFound         bool
	phoneticsAdded   int
	definitionsAdded int
	formsAdded       int
	categoriesAdded  int
}

// enrichWord enriches an existing word with ECDICT data
func (s *ecdictStage) enrichWord(ctx context.Context, client dictv1connect.DictServiceClient, enrichmentData *dictv1.Word) (*enrichmentResult, error) {
	result := &enrichmentResult{}

	// Lookup existing word
	lookupReq := connect.NewRequest(&dictv1.LookupWordRequest{Word: enrichmentData.Term})
	lookupResp, err := client.LookupWord(ctx, lookupReq)
	if err != nil {
		// Word doesn't exist, skip enrichment
		if connect.CodeOf(err) == connect.CodeNotFound {
			result.notFound = true
			return result, nil
		}
		return result, fmt.Errorf("lookup word: %w", err)
	}

	existingWord := lookupResp.Msg
	if existingWord == nil {
		result.notFound = true
		return result, nil
	}

	// Count existing data before merge
	existingPhonetics := len(existingWord.Phonetics)
	existingDefinitionsCount := 0
	for _, m := range existingWord.Meanings {
		existingDefinitionsCount += len(m.Definitions)
	}
	existingForms := len(existingWord.RelatedForms)
	existingCategories := len(existingWord.Categories)

	// Merge ECDICT data into existing word
	merged := mergeWords(existingWord, enrichmentData)

	// Count new data after merge
	newPhonetics := len(merged.Phonetics)
	newDefinitionsCount := 0
	for _, m := range merged.Meanings {
		newDefinitionsCount += len(m.Definitions)
	}
	newForms := len(merged.RelatedForms)
	newCategories := len(merged.Categories)

	// Calculate what was added
	result.phoneticsAdded = newPhonetics - existingPhonetics
	result.definitionsAdded = newDefinitionsCount - existingDefinitionsCount
	result.formsAdded = newForms - existingForms
	result.categoriesAdded = newCategories - existingCategories

	// Update with merged data
	_, updateErr := client.UpdateWord(ctx, connect.NewRequest(merged))
	if updateErr != nil {
		return result, fmt.Errorf("update word: %w", updateErr)
	}

	result.succeeded = true
	log.Printf("[ecdict] Enriched word %s (added: %d phonetics, %d definitions, %d forms, %d categories)",
		enrichmentData.Term, result.phoneticsAdded, result.definitionsAdded,
		result.formsAdded, result.categoriesAdded)
	return result, nil
}

// createOrUpdateWord creates a new word or updates existing word in the database
// This implements the same merge strategy as wikidata stage
func (s *ecdictStage) createOrUpdateWord(ctx context.Context, client dictv1connect.DictServiceClient, newWord *dictv1.Word) error {
	// Try to create first
	req := connect.NewRequest(&dictv1.CreateWordRequest{Word: newWord})
	resp, err := client.CreateWord(ctx, req)
	if err != nil {
		// If already exists, merge with existing
		errCode := connect.CodeOf(err)
		isAlreadyExists := errCode == connect.CodeAlreadyExists ||
			strings.Contains(err.Error(), "AlreadyExists") ||
			strings.Contains(err.Error(), "word already exists")

		if !isAlreadyExists {
			return fmt.Errorf("failed to create word: %w", err)
		}

		log.Printf("[ecdict] Word %s already exists, merging...", newWord.Term)

		// Lookup existing word by lemma
		lookupReq := connect.NewRequest(&dictv1.LookupWordRequest{Word: newWord.Term})
		lookupResp, lookupErr := client.LookupWord(ctx, lookupReq)
		if lookupErr != nil {
			return fmt.Errorf("lookup existing word: %w", lookupErr)
		}

		existingWord := lookupResp.Msg
		if existingWord == nil {
			return fmt.Errorf("existing word not found after AlreadyExists error")
		}

		log.Printf("[ecdict] Existing word has %d meanings, new has %d", len(existingWord.GetMeanings()), len(newWord.GetMeanings()))

		// Merge new ECDICT data into existing word
		merged := mergeWords(existingWord, newWord)

		log.Printf("[ecdict] Merged word has %d meanings", len(merged.GetMeanings()))

		// Update with merged data
		_, updateErr := client.UpdateWord(ctx, connect.NewRequest(merged))
		if updateErr != nil {
			return fmt.Errorf("update merged word: %w", updateErr)
		}

		return nil
	}

	if resp.Msg == nil {
		return fmt.Errorf("server returned nil response")
	}

	log.Printf("[ecdict] Created word %s with %d meanings", newWord.Term, len(newWord.GetMeanings()))
	return nil
}

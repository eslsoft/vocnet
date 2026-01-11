package main

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/schollz/progressbar/v3"
)

type ecdictEnrichmentImporter struct {
	importService *LexemeImportService
	batchSize     int
	report        *ImportReport
	reportMu      sync.Mutex
}

func newECDictEnrichmentImporter(cfg pipelineConfig, importService *LexemeImportService) *ecdictEnrichmentImporter {
	return &ecdictEnrichmentImporter{
		importService: importService,
		batchSize:     cfg.batchSize,
		report:        NewImportReport("ECDICT-Enrichment"),
	}
}

func (imp *ecdictEnrichmentImporter) Run(ctx context.Context, wordsToEnrich []ecdictWord) (*ImportReport, error) {
	if len(wordsToEnrich) == 0 {
		return imp.report, nil
	}

	log.Printf("[ecdict-enrich] Starting enrichment for %d words", len(wordsToEnrich))
	imp.report.Statistics.Total = int64(len(wordsToEnrich))

	// Create progress bar
	bar := progressbar.NewOptions(len(wordsToEnrich),
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

	jobCh := make(chan ecdictWord, imp.batchSize*2)
	resultCh := make(chan ecdictEnrichmentResult, imp.batchSize*2)
	var wg sync.WaitGroup

	var succeeded, failed, notFound int64
	var totalPhoneticsAdded, totalSensesAdded, totalFormsAdded, totalCategoriesAdded int64

	// Start workers
	for i := 0; i < imp.batchSize; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for word := range jobCh {
				result := imp.enrichWord(ctx, word)
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
				imp.report.AddFailureSample(result.word, "enrich_error", result.err.Error())
				imp.reportMu.Unlock()
				log.Printf("[ecdict-enrich] failed to enrich %s: %v", result.word, result.err)
			} else if result.notFound {
				atomic.AddInt64(&notFound, 1)
			} else if result.succeeded {
				atomic.AddInt64(&succeeded, 1)

				// Track what was added
				atomic.AddInt64(&totalPhoneticsAdded, int64(result.phoneticsAdded))
				atomic.AddInt64(&totalSensesAdded, int64(result.sensesAdded))
				atomic.AddInt64(&totalFormsAdded, int64(result.formsAdded))
				atomic.AddInt64(&totalCategoriesAdded, int64(result.categoriesAdded))

				imp.reportMu.Lock()
				imp.report.AddSuccessSample(result.word, nil, result.phoneticsAdded > 0, false)
				imp.reportMu.Unlock()
			}
		}
	}()

	// Send words to workers
	for _, word := range wordsToEnrich {
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

	log.Printf("[ecdict-enrich] done. succeeded=%d failed=%d notFound=%d", succeeded, failed, notFound)
	log.Printf("[ecdict-enrich] Added: %d phonetics, %d senses, %d forms, %d categories",
		totalPhoneticsAdded, totalSensesAdded, totalFormsAdded, totalCategoriesAdded)

	fmt.Printf("✓ Enrichment: %d succeeded, %d failed, %d not found\n", succeeded, failed, notFound)
	fmt.Printf("  Added: %d phonetics, %d senses, %d forms, %d categories\n",
		totalPhoneticsAdded, totalSensesAdded, totalFormsAdded, totalCategoriesAdded)

	// Finalize report
	imp.report.Finalize()

	// Save report
	reportPath := "reports/ecdict_enrichment_report.json"
	if err := imp.report.SaveToFile(reportPath); err != nil {
		log.Printf("[ecdict-enrich] Warning: failed to save report to %s: %v", reportPath, err)
	} else {
		log.Printf("[ecdict-enrich] Report saved to %s", reportPath)
	}

	return imp.report, nil
}

type ecdictEnrichmentResult struct {
	word             string
	succeeded        bool
	notFound         bool
	phoneticsAdded   int
	sensesAdded      int
	formsAdded       int
	categoriesAdded  int
	err              error
}

func (imp *ecdictEnrichmentImporter) enrichWord(ctx context.Context, word ecdictWord) ecdictEnrichmentResult {
	result := ecdictEnrichmentResult{
		word: word.word,
	}

	// Find existing lexeme by lemma surface
	existing, err := imp.importService.FindLexemeByLemmaSurface(ctx, word.word, "en")
	if err != nil {
		result.err = fmt.Errorf("find existing: %w", err)
		return result
	}

	if existing == nil {
		result.notFound = true
		return result
	}

	// Build enrichment data from ECDICT
	enrichmentData, err := BuildECDictLexeme(word.word, word.enrichment)
	if err != nil || enrichmentData == nil {
		result.err = fmt.Errorf("build enrichment: %w", err)
		return result
	}

	// Merge enrichment data into existing
	merged := mergeEnrichmentData(existing, enrichmentData)

	// Count what was added
	result.phoneticsAdded = countNewPhonetics(existing.Lemmas[0].Forms, merged.Lemmas[0].Forms)
	result.sensesAdded = countNewSenses(existing.Lexeme.Senses, merged.Lexeme.Senses)
	result.formsAdded = countNewForms(existing.Lemmas[0].Forms, merged.Lemmas[0].Forms)
	result.categoriesAdded = countNewCategories(existing.Lexeme.Categories, merged.Lexeme.Categories)

	// Update the lexeme
	err = imp.importService.CreateOrUpdateComplete(ctx, merged)
	if err != nil {
		result.err = fmt.Errorf("update lexeme: %w", err)
		return result
	}

	result.succeeded = true
	return result
}

// mergeEnrichmentData merges ECDICT enrichment data into existing lexeme data.
func mergeEnrichmentData(existing, enrichment *ImportLexemeData) *ImportLexemeData {
	merged := &ImportLexemeData{
		Lexeme: &entity.Lexeme{
			ID:           existing.Lexeme.ID,
			ExternalID:   existing.Lexeme.ExternalID,
			Language:     existing.Lexeme.Language,
			PartOfSpeech: existing.Lexeme.PartOfSpeech,
			EntryType:    existing.Lexeme.EntryType,
			Level:        existing.Lexeme.Level,
			Frequencies:  existing.Lexeme.Frequencies,
			SenseGloss:   existing.Lexeme.SenseGloss,
			Senses:       mergeSensesEnrichment(existing.Lexeme.Senses, enrichment.Lexeme.Senses),
			Relations:    existing.Lexeme.Relations,
			Categories:   mergeStringSlices(existing.Lexeme.Categories, enrichment.Lexeme.Categories),
			Completeness: existing.Lexeme.Completeness,
		},
		Lemmas: []*ImportLemmaData{{
			Surface:    existing.Lemmas[0].Surface,
			Normalized: existing.Lemmas[0].Normalized,
			Variant:    existing.Lemmas[0].Variant,
			IsPrimary:  existing.Lemmas[0].IsPrimary,
			Forms:      mergeFormsEnrichment(existing.Lemmas[0].Forms, enrichment.Lemmas[0].Forms),
		}},
	}

	return merged
}

// mergeSensesEnrichment merges senses, prioritizing existing English senses over Chinese.
func mergeSensesEnrichment(existing, incoming []entity.LexemeSense) []entity.LexemeSense {
	result := make([]entity.LexemeSense, 0, len(existing)+len(incoming))
	seen := make(map[string]struct{})

	// Add existing senses first
	for _, sense := range existing {
		key := fmt.Sprintf("%s:%s", sense.Language.CodeOrDefault(), sense.Gloss)
		if _, ok := seen[key]; !ok {
			result = append(result, sense)
			seen[key] = struct{}{}
		}
	}

	// Add new senses from enrichment
	for _, sense := range incoming {
		key := fmt.Sprintf("%s:%s", sense.Language.CodeOrDefault(), sense.Gloss)
		if _, ok := seen[key]; !ok {
			result = append(result, sense)
			seen[key] = struct{}{}
		}
	}

	return result
}

// mergeFormsEnrichment merges forms, adding phonetics from ECDICT to existing forms.
func mergeFormsEnrichment(existing, incoming []*entity.LemmaForm) []*entity.LemmaForm {
	result := make([]*entity.LemmaForm, 0, len(existing)+len(incoming))
	seen := make(map[string]*entity.LemmaForm)

	// Index existing forms
	for _, form := range existing {
		key := form.Normalized
		seen[key] = form
		result = append(result, form)
	}

	// Merge phonetics from ALL incoming forms
	for _, incForm := range incoming {
		if len(incForm.Phonetics) > 0 {
			// Find matching existing form by text
			if existForm, ok := seen[incForm.Normalized]; ok {
				existForm.Phonetics = mergePhoneticsEnrichment(existForm.Phonetics, incForm.Phonetics)
			} else {
				// If not found by text, check if we are dealing with the lemma form
				// This handles cases where lemma text might differ slightly or we want to force match lemma-to-lemma
				if incForm.FormType == entity.LexemeFormTypeLemma {
					for _, form := range result {
						if form.FormType == entity.LexemeFormTypeLemma {
							form.Phonetics = mergePhoneticsEnrichment(form.Phonetics, incForm.Phonetics)
							break
						}
					}
				}
			}
		}
	}

	// Add new forms from enrichment (non-lemma forms)
	for _, form := range incoming {
		if form.FormType == entity.LexemeFormTypeLemma {
			continue // Skip lemma form, already handled (merging phonetics only)
		}
		if _, ok := seen[form.Normalized]; !ok {
			result = append(result, form)
			seen[form.Normalized] = form
		}
	}

	return result
}

// mergePhoneticsEnrichment merges phonetics arrays.
func mergePhoneticsEnrichment(existing, incoming []entity.Phonetic) []entity.Phonetic {
	if len(existing) == 0 {
		return incoming
	}

	seen := make(map[string]struct{})
	result := make([]entity.Phonetic, 0, len(existing)+len(incoming))

	for _, p := range existing {
		key := p.IPA + "|" + p.Dialect
		if _, ok := seen[key]; !ok {
			result = append(result, p)
			seen[key] = struct{}{}
		}
	}

	for _, p := range incoming {
		key := p.IPA + "|" + p.Dialect
		if _, ok := seen[key]; !ok {
			result = append(result, p)
			seen[key] = struct{}{}
		}
	}

	return result
}

// Helper functions to count additions
func countNewPhonetics(oldForms, newForms []*entity.LemmaForm) int {
	oldCount := 0
	newCount := 0
	for _, f := range oldForms {
		oldCount += len(f.Phonetics)
	}
	for _, f := range newForms {
		newCount += len(f.Phonetics)
	}
	return newCount - oldCount
}

func countNewSenses(oldSenses, newSenses []entity.LexemeSense) int {
	return len(newSenses) - len(oldSenses)
}

func countNewForms(oldForms, newForms []*entity.LemmaForm) int {
	return len(newForms) - len(oldForms)
}

func countNewCategories(oldCats, newCats []string) int {
	return len(newCats) - len(oldCats)
}

package ecdict

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	reportpkg "github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/schollz/progressbar/v3"
)

type ecdictEnrichmentImporter struct {
	importService *store.LexemeImportService
	batchSize     int
	report        *reportpkg.ImportReport
}

func newECDictEnrichmentImporter(batchSize int, importService *store.LexemeImportService, report *reportpkg.ImportReport) *ecdictEnrichmentImporter {
	if report == nil {
		report = reportpkg.NewImportReport("ECDICT")
	}
	return &ecdictEnrichmentImporter{
		importService: importService,
		batchSize:     batchSize,
		report:        report,
	}
}

func (imp *ecdictEnrichmentImporter) Run(ctx context.Context, wordsToEnrich []ecdictWord) (*reportpkg.ImportReport, error) {
	if len(wordsToEnrich) == 0 {
		return imp.report, nil
	}

	log.Printf("[ecdict-enrich] Starting enrichment for %d words", len(wordsToEnrich))
	imp.report.Statistics.Total = int64(len(wordsToEnrich))
	if imp.report.Enrichment == nil {
		imp.report.Enrichment = &reportpkg.EnrichmentStats{}
	}

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
	progressCh := make(chan struct{}, imp.batchSize*4)
	statsCh := make(chan ecdictWorkerStats, imp.batchSize)
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
			stats := newECDictWorkerStats()
			for word := range jobCh {
				result := imp.enrichWord(ctx, word)
				stats.applyResult(result)
				progressCh <- struct{}{}
			}
			statsCh <- stats
		}(i + 1)
	}

	// Send words to workers
	for _, word := range wordsToEnrich {
		jobCh <- word
	}
	close(jobCh)

	wg.Wait()
	close(progressCh)
	<-progressDone
	close(statsCh)
	bar.Finish()

	aggregate := newECDictWorkerStats()
	for stats := range statsCh {
		aggregate.merge(stats)
	}

	// Update final statistics
	imp.report.Statistics.Successful = aggregate.succeeded
	imp.report.Statistics.Failed = aggregate.failed
	imp.report.Enrichment.Attempted = int64(len(wordsToEnrich))
	imp.report.Enrichment.Succeeded = aggregate.succeeded
	imp.report.Enrichment.Failed = aggregate.failed
	imp.report.Enrichment.NotFound = aggregate.notFound
	imp.report.Enrichment.PhoneticsAdded = aggregate.totalPhoneticsAdded
	imp.report.Enrichment.DefinitionsAdded = aggregate.totalSensesAdded
	imp.report.Enrichment.FormsAdded = aggregate.totalFormsAdded
	imp.report.Samples.SuccessExamples = aggregate.successSamples
	imp.report.Samples.FailureExamples = aggregate.failureSamples

	log.Printf("[ecdict-enrich] done. succeeded=%d failed=%d notFound=%d", aggregate.succeeded, aggregate.failed, aggregate.notFound)
	log.Printf("[ecdict-enrich] Added: %d phonetics, %d senses, %d forms",
		aggregate.totalPhoneticsAdded, aggregate.totalSensesAdded, aggregate.totalFormsAdded)

	fmt.Printf("✓ Enrichment: %d succeeded, %d failed, %d not found\n", aggregate.succeeded, aggregate.failed, aggregate.notFound)
	fmt.Printf("  Added: %d phonetics, %d senses, %d forms\n",
		aggregate.totalPhoneticsAdded, aggregate.totalSensesAdded, aggregate.totalFormsAdded)

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
	word           string
	succeeded      bool
	notFound       bool
	phoneticsAdded int
	sensesAdded    int
	formsAdded     int
	err            error
}

func (imp *ecdictEnrichmentImporter) enrichWord(ctx context.Context, word ecdictWord) ecdictEnrichmentResult {
	result := ecdictEnrichmentResult{
		word: word.word,
	}

	// Find ALL existing lexemes by lemma surface (to handle multiple POS)
	existingLexemes, err := imp.importService.FindAllLexemesByLemmaSurface(ctx, word.word, "en")
	if err != nil {
		result.err = fmt.Errorf("find existing: %w", err)
		return result
	}

	if len(existingLexemes) == 0 {
		result.notFound = true
		return result
	}

	// Enrich each lexeme with POS-filtered senses
	var lastErr error
	enrichedCount := 0

	for _, existing := range existingLexemes {
		// Build enrichment data filtered by this lexeme's POS
		enrichmentData, err := BuildECDictEnrichmentForPOS(word.word, word.enrichment, existing.Lexeme.PartOfSpeech)
		if err != nil {
			lastErr = fmt.Errorf("build enrichment for POS %s: %w", existing.Lexeme.PartOfSpeech, err)
			log.Printf("[ecdict-enrich] Warning: failed to build enrichment for '%s' POS %s: %v",
				word.word, existing.Lexeme.PartOfSpeech, err)
			continue
		}

		// If no matching senses for this POS, skip
		if enrichmentData == nil || len(enrichmentData.Lexeme.Senses) == 0 {
			continue
		}

		oldPhonetics := countTotalPhonetics(existing.Lemmas[0].Forms)
		oldSenses := len(existing.Lexeme.Senses)
		oldForms := len(existing.Lemmas[0].Forms)

		// Merge enrichment data into existing
		merged := mergeEnrichmentData(existing, enrichmentData)

		// Update the lexeme
		err = imp.importService.CreateOrUpdateComplete(ctx, merged)
		if err != nil {
			lastErr = fmt.Errorf("update lexeme %s: %w", existing.Lexeme.ExternalID, err)
			log.Printf("[ecdict-enrich] Warning: failed to enrich lexeme %s for word '%s' POS %s: %v",
				existing.Lexeme.ExternalID, word.word, existing.Lexeme.PartOfSpeech, err)
			continue
		}

		// Count what was added for this lexeme
		newPhonetics := countTotalPhonetics(merged.Lemmas[0].Forms)
		newSenses := len(merged.Lexeme.Senses)
		newForms := len(merged.Lemmas[0].Forms)

		result.phoneticsAdded += (newPhonetics - oldPhonetics)
		result.sensesAdded += (newSenses - oldSenses)
		result.formsAdded += (newForms - oldForms)

		enrichedCount++
	}

	if enrichedCount == 0 {
		// If no lexemes were enriched, consider it "not found" rather than an error
		// This can happen if ECDICT has the word but no senses match any lexeme's POS
		if lastErr != nil {
			result.err = lastErr
		} else {
			result.notFound = true
		}
		return result
	}

	// Consider it successful if we enriched at least one lexeme
	result.succeeded = true
	return result
}

// mergeEnrichmentData merges ECDICT enrichment data into existing lexeme data.
func mergeEnrichmentData(existing, enrichment *store.ImportLexemeData) *store.ImportLexemeData {
	merged := &store.ImportLexemeData{
		Lexeme: &entity.Lexeme{
			ID:           existing.Lexeme.ID,
			ExternalID:   existing.Lexeme.ExternalID,
			Language:     existing.Lexeme.Language,
			PartOfSpeech: existing.Lexeme.PartOfSpeech,
			EntryType:    existing.Lexeme.EntryType,
			Level:        existing.Lexeme.Level,
			Frequencies:  mergeFrequencies(existing.Lexeme.Frequencies, enrichment.Lexeme.Frequencies),
			SenseGloss:   existing.Lexeme.SenseGloss,
			Senses:       mergeSensesEnrichment(existing.Lexeme.Senses, enrichment.Lexeme.Senses),
			Relations:    existing.Lexeme.Relations,
			Categories:   existing.Lexeme.Categories,
			Completeness: existing.Lexeme.Completeness,
		},
		Lemmas: []*store.ImportLemmaData{{
			Surface:    existing.Lemmas[0].Surface,
			Normalized: existing.Lemmas[0].Normalized,
			Variant:    existing.Lemmas[0].Variant,
			IsPrimary:  existing.Lemmas[0].IsPrimary,
			Forms:      mergeFormsEnrichment(existing.Lemmas[0].Forms, enrichment.Lemmas[0].Forms),
		}},
	}

	return merged
}

func mergeFrequencies(existing, incoming []entity.Frequency) []entity.Frequency {
	if len(incoming) == 0 {
		return existing
	}
	if len(existing) == 0 {
		return incoming
	}

	seen := make(map[string]struct{}, len(existing))
	merged := make([]entity.Frequency, 0, len(existing)+len(incoming))

	for _, freq := range existing {
		key := strings.ToLower(strings.TrimSpace(freq.Corpus))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, freq)
	}

	for _, freq := range incoming {
		key := strings.ToLower(strings.TrimSpace(freq.Corpus))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, freq)
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
func countTotalPhonetics(forms []*entity.LemmaForm) int {
	total := 0
	for _, f := range forms {
		total += len(f.Phonetics)
	}
	return total
}

func countNewSenses(oldSenses, newSenses []entity.LexemeSense) int {
	return len(newSenses) - len(oldSenses)
}

func countNewForms(oldForms, newForms []*entity.LemmaForm) int {
	return len(newForms) - len(oldForms)
}

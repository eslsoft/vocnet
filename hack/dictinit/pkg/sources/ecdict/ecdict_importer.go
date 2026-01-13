package ecdict

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
)

type Importer struct {
	importService *store.LexemeImportService
	enricher      *Enricher
	batchSize     int
	report        *report.ImportReport
}

type ecdictWord struct {
	word       string
	enrichment *ecdictEnrichment
}

func NewImporter(batchSize int, importService *store.LexemeImportService, enricher *Enricher) *Importer {
	return &Importer{
		importService: importService,
		enricher:      enricher,
		batchSize:     batchSize,
		report:        report.NewImportReport("ECDICT"),
	}
}

func (imp *Importer) Name() string {
	return "ecdict"
}

func (imp *Importer) Run(ctx context.Context) (*report.ImportReport, error) {
	if imp.enricher == nil {
		return nil, fmt.Errorf("ecdict enricher not initialized")
	}

	log.Println("[ecdict] Starting ECDICT enrichment using import service")

	// Collect words to enrich from enricher (existing data only).
	log.Println("[ecdict] Extracting words from ECDICT...")
	wordsToEnrich, skipped := imp.enricher.CollectEnrichmentWords()
	log.Printf("[ecdict] Found %d words to enrich, %d skipped", len(wordsToEnrich), len(skipped))

	// Update statistics for skipped words
	for _, skip := range skipped {
		imp.report.Statistics.Skipped++
		imp.report.AddSkippedSample(skip.word, skip.reason)

		// Track missing fields
		switch skip.reason {
		case "no_useful_data":
			imp.report.AddMissingField("useful_data")
		case "not_in_db":
			imp.report.AddMissingField("missing_base_entry")
		}
	}

	if len(wordsToEnrich) > 0 {
		log.Println("\n" + strings.Repeat("=", 80))
		log.Println("STAGE 2: ECDICT Enrichment")
		log.Println(strings.Repeat("=", 80))

		enricher := newECDictEnrichmentImporter(imp.batchSize, imp.importService, imp.report)
		enrichReport, err := enricher.Run(ctx, wordsToEnrich)
		if err != nil {
			log.Printf("[ecdict-enrich] Warning: enrichment had errors: %v", err)
		}
		return enrichReport, nil
	}

	log.Println("[ecdict] No existing words to enrich")
	imp.report.Finalize()
	if err := imp.report.SaveToFile("reports/ecdict_enrichment_report.json"); err != nil {
		log.Printf("[ecdict] Warning: failed to save report: %v", err)
	}
	return imp.report, nil
}

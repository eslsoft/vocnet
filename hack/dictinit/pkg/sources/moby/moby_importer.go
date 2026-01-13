package moby

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	"github.com/schollz/progressbar/v3"
)

type Importer struct {
	importService *store.LexemeImportService
	filePath      string
	batchSize     int
	report        *report.ImportReport
	knownForms    map[string]struct{}
}

func NewImporter(filePath string, batchSize int, importService *store.LexemeImportService) *Importer {
	return &Importer{
		importService: importService,
		filePath:      filePath,
		batchSize:     batchSize,
		report:        report.NewImportReport("Moby"),
	}
}

func (imp *Importer) Name() string {
	return "moby"
}

func (imp *Importer) Run(ctx context.Context) (*report.ImportReport, error) {
	log.Printf("[moby] Starting Moby import from %s", imp.filePath)

	knownForms, err := imp.importService.LoadKnownForms(ctx)
	if err != nil {
		return nil, fmt.Errorf("load known forms: %w", err)
	}
	imp.knownForms = knownForms
	log.Printf("[moby] Loaded %d known forms", len(knownForms))

	file, err := os.Open(imp.filePath)
	if err != nil {
		return nil, fmt.Errorf("open moby file: %w", err)
	}
	defer file.Close()

	lineCount, _ := countLines(imp.filePath)
	bar := progressbar.NewOptions(lineCount,
		progressbar.OptionSetDescription("📖 Moby"),
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
	)

	jobCh := make(chan []byte, imp.batchSize*2)
	progressCh := make(chan struct{}, imp.batchSize*4)
	statsCh := make(chan mobyWorkerStats, imp.batchSize)
	var wg sync.WaitGroup

	var skippedLogCount int64

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
		go func() {
			defer wg.Done()
			stats := mobyWorkerStats{}
			for line := range jobCh {
				err := imp.processLine(ctx, line)
				stats.applyResult(err, &skippedLogCount)
				progressCh <- struct{}{}
			}
			statsCh <- stats
		}()
	}

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		b := scanner.Bytes()
		line := make([]byte, len(b))
		copy(line, b)
		jobCh <- line
	}
	close(jobCh)

	wg.Wait()
	close(progressCh)
	<-progressDone
	close(statsCh)
	bar.Finish()

	var succeeded, skipped, failed int64
	for stats := range statsCh {
		succeeded += stats.succeeded
		skipped += stats.skipped
		failed += stats.failed
	}

	imp.report.Statistics.Total = int64(lineCount)
	imp.report.Statistics.Successful = succeeded
	imp.report.Statistics.Skipped = skipped
	imp.report.Statistics.Failed = failed
	imp.report.Finalize()
	imp.report.SaveToFile("reports/moby_import_report.json")

	log.Printf("[moby] Done. Succeeded: %d, Skipped: %d, Failed: %d", succeeded, skipped, failed)
	return imp.report, nil
}

func (imp *Importer) processLine(ctx context.Context, lineBytes []byte) error {
	// Replace 0xA5 (Moby separator) with space
	for i, b := range lineBytes {
		if b == 0xA5 {
			lineBytes[i] = ' '
		}
	}

	// Convert to string (assuming the rest is ASCII/UTF-8 compatible)
	line := string(lineBytes)
	line = strings.TrimSpace(line)
	if line == "" {
		return fmt.Errorf("skipped: empty line")
	}

	// Moby format uses various separators: usually hyphens '-' or bullets '•' (UTF-8: \u2022)
	// We normalize all to a space then split.
	// (Note: we already replaced 0xA5 with space above)
	normalized := strings.ReplaceAll(line, "•", " ")
	normalized = strings.ReplaceAll(normalized, "-", " ")
	parts := strings.Fields(normalized)

	if len(parts) <= 1 {
		return fmt.Errorf("skipped: single syllable or invalid format")
	}

	// Reconstruct the full word
	word := strings.Join(parts, "")

	wordKey := util.NormalizeKey(word)
	if wordKey == "" {
		return fmt.Errorf("skipped: empty word")
	}
	if _, ok := imp.knownForms[wordKey]; !ok {
		return fmt.Errorf("skipped: %s not found in db", word)
	}

	// Find in DB
	importData, err := imp.importService.FindLexemeByLemmaSurface(ctx, word, "en")
	if err != nil {
		return fmt.Errorf("db error for %s: %w", word, err)
	}
	if importData == nil {
		return fmt.Errorf("skipped: %s not found in db", word)
	}

	updated := false
	for _, lemma := range importData.Lemmas {
		// Only update if currently empty
		if strings.EqualFold(lemma.Surface, word) && len(lemma.Syllables) == 0 {
			lemma.Syllables = parts
			updated = true
		}
		for _, form := range lemma.Forms {
			if strings.EqualFold(form.Surface, word) && len(form.Syllables) == 0 {
				form.Syllables = parts
				updated = true
			}
		}
	}

	if !updated {
		return fmt.Errorf("skipped: %s no update needed", word)
	}

	return imp.importService.CreateOrUpdateComplete(ctx, importData)
}

func countLines(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	r := bufio.NewReader(f)
	buf := make([]byte, 32*1024)
	count := 0
	lineSep := []byte{'\n'}

	for {
		c, err := r.Read(buf)
		count += bytes.Count(buf[:c], lineSep)

		switch {
		case err == io.EOF:
			return count, nil

		case err != nil:
			return count, err
		}
	}
}

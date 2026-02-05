package youdaodict

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/schollz/progressbar/v3"
)

type Importer struct {
	batchSize int
	store     *store.LexemeImportService
	enricher  *Enricher
}

func NewImporter(batchSize int, store *store.LexemeImportService, enricher *Enricher) *Importer {
	return &Importer{
		batchSize: batchSize,
		store:     store,
		enricher:  enricher,
	}
}

func (i *Importer) Run(ctx context.Context) (*report.ImportReport, error) {
	rep := report.NewImportReport("YoudaoDict")
	rep.Enrichment = &report.EnrichmentStats{}

	if i.enricher == nil {
		return nil, fmt.Errorf("youdao enricher not initialized")
	}

	// 1. Collect words to enrich
	wordsToEnrich := i.enricher.CollectEnrichmentWords()
	log.Printf("[youdao] found %d words to enrich", len(wordsToEnrich))

	if len(wordsToEnrich) == 0 {
		rep.Finalize()
		return rep, nil
	}

	jobCh := make(chan YoudaoWord, i.batchSize*2)
	statsCh := make(chan workerStats, i.batchSize)
	progressCh := make(chan int, i.batchSize*2)
	var wg sync.WaitGroup

	bar := progressbar.NewOptions(len(wordsToEnrich),
		progressbar.OptionSetDescription("🔧 Youdao Enrichment (Gloss, IPA & Relations)"),
		progressbar.OptionSetWidth(40),
		progressbar.OptionShowCount(),
		progressbar.OptionShowIts(),
		progressbar.OptionThrottle(100*time.Millisecond),
	)

	progressDone := make(chan struct{})
	go func() {
		defer close(progressDone)
		for n := range progressCh {
			bar.Add(n)
		}
	}()

	for w := 0; w < i.batchSize; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stats := newWorkerStats()
			for word := range jobCh {
				res := i.enrichWord(ctx, word)
				stats.applyResult(res)
				progressCh <- 1
			}
			statsCh <- stats
		}()
	}

	// Send words to workers
	go func() {
		defer close(jobCh)
		for _, word := range wordsToEnrich {
			jobCh <- word
		}
	}()

	wg.Wait()
	close(progressCh)
	<-progressDone
	close(statsCh)
	bar.Finish()
	fmt.Println()

	finalStats := newWorkerStats()
	for s := range statsCh {
		finalStats.merge(s)
	}

	rep.Statistics.Total = int64(len(wordsToEnrich))
	rep.Statistics.Successful = finalStats.succeeded
	rep.Statistics.Failed = finalStats.failed
	rep.Statistics.Skipped = finalStats.skipped
	rep.Enrichment.Attempted = rep.Statistics.Total
	rep.Enrichment.Succeeded = finalStats.succeeded
	rep.Enrichment.Failed = finalStats.failed
	rep.Enrichment.NotFound = finalStats.notFound
	rep.Enrichment.PhoneticsAdded = finalStats.totalPhoneticsAdded
	rep.Enrichment.DefinitionsAdded = finalStats.totalSensesAdded

	rep.Finalize()

	// Save report
	reportPath := "reports/youdao_import_report.json"
	if err := rep.SaveToFile(reportPath); err != nil {
		log.Printf("[youdao] Warning: failed to save report to %s: %v", reportPath, err)
	} else {
		log.Printf("[youdao] Report saved to %s", reportPath)
	}

	return rep, nil
}

func (i *Importer) enrichWord(ctx context.Context, word YoudaoWord) enrichmentResult {
	term := word.HeadWord
	if term == "" {
		term = word.Content.Word.WordHead
	}
	res := enrichmentResult{term: term}
	if res.term == "" {
		res.skipped = true
		return res
	}

	lexemes, err := i.store.FindAllLexemesByLemmaSurface(ctx, res.term, "en")
	if err != nil {
		res.err = err
		return res
	}
	if len(lexemes) == 0 {
		res.notFound = true
		return res
	}

	enrichedCount := 0
	for _, lexData := range lexemes {
		if i.applyEnrichment(lexData, word) {
			if err := i.store.CreateOrUpdateComplete(ctx, lexData); err != nil {
				res.err = fmt.Errorf("update failed: %w", err)
				continue
			}
			enrichedCount++
			res.succeeded = true
		}
	}

	if enrichedCount == 0 {
		res.skipped = true
	}
	return res
}

func (i *Importer) applyEnrichment(data *store.ImportLexemeData, word YoudaoWord) bool {
	changed := false
	content := word.Content.Word.Content

	// 1. Phonetics
	for _, lemma := range data.Lemmas {
		for _, form := range lemma.Forms {
			if form.FormType == entity.LexemeFormTypeLemma {
				if i.mergePhonetics(form, content.USPhone, content.UKPhone) {
					changed = true
				}
			}
		}
	}

	// 2. Chinese Senses
	posMatched := false
	standardPOS := data.Lexeme.PartOfSpeech
	for _, trans := range content.Trans {
		youdaoPOS := MapPOS(trans.Pos)
		if youdaoPOS == "" || youdaoPOS == standardPOS {
			posMatched = true
			if i.mergeSense(data.Lexeme, strings.TrimSpace(trans.TranCn)) {
				changed = true
			}
		}
	}
	if !posMatched && len(content.Trans) > 0 {
		if i.mergeSense(data.Lexeme, strings.TrimSpace(content.Trans[0].TranCn)) {
			changed = true
		}
	}

	// 3. Relationships
	if i.enrichRelations(data.Lexeme, word) {
		changed = true
	}

	if changed {
		data.Lexeme.Completeness = i.calculateCompleteness(data.Lexeme)
	}
	return changed
}

func (i *Importer) enrichRelations(lex *entity.Lexeme, word YoudaoWord) bool {
	changed := false
	content := word.Content.Word.Content

	// Helper to add a relation
	addRel := func(targetTerm string, relType int32, posHint string) {
		key := util.NormalizeKey(targetTerm)
		candidates, ok := i.enricher.surfaceToExtID[key]
		if !ok || len(candidates) == 0 {
			return
		}

		desiredPOS := MapPOS(posHint)
		if desiredPOS == "" {
			desiredPOS = lex.PartOfSpeech
		}

		pick := func(matchPOS bool) (string, bool) {
			for _, c := range candidates {
				if c.ExternalID == "" || c.ExternalID == lex.ExternalID {
					continue
				}
				if matchPOS && desiredPOS != "" && c.Pos != desiredPOS {
					continue
				}
				return c.ExternalID, true
			}
			return "", false
		}

		targetExtID, ok := pick(true)
		if !ok {
			targetExtID, ok = pick(false)
		}
		if !ok {
			return
		}

		// Check if relation exists
		found := false
		for _, r := range lex.Relations {
			if r.TargetLexemeID == targetExtID && r.RelationType == relType {
				found = true
				break
			}
		}
		if !found {
			lex.Relations = append(lex.Relations, entity.LexemeRelation{
				LexemeID:       lex.ExternalID,
				TargetLexemeID: targetExtID,
				RelationType:   relType,
			})
			changed = true
		}
	}

	// 1. Synonyms (RelationType 1)
	for _, s := range content.Syno.Synos {
		for _, h := range s.Hwds {
			addRel(h.W, 1, s.Pos)
		}
	}

	// 2. Antonyms (RelationType 2)
	for _, a := range content.Anto.Antos {
		for _, h := range a.Hwds {
			addRel(h.W, 2, a.Pos)
		}
	}

	// 3. Related Words (Root/Association -> RelationType 8: DERIVATIVE)
	for _, r := range content.RelWord.Rels {
		for _, w := range r.Words {
			addRel(w.Hwd, 8, r.Pos)
		}
	}

	return changed
}

func (i *Importer) mergePhonetics(form *entity.LemmaForm, us, uk string) bool {
	changed := false
	if us != "" {
		if i.addPhonetic(form, us, "en-US") {
			changed = true
		}
	}
	if uk != "" {
		if i.addPhonetic(form, uk, "en-UK") {
			changed = true
		}
	}
	return changed
}

func (i *Importer) addPhonetic(form *entity.LemmaForm, ipa, dialect string) bool {
	for j, p := range form.Phonetics {
		if p.Dialect == dialect {
			if p.IPA == "" {
				form.Phonetics[j].IPA = ipa
				return true
			}
			// Already has IPA for this dialect, don't overwrite
			return false
		}
	}
	form.Phonetics = append(form.Phonetics, entity.Phonetic{IPA: ipa, Dialect: dialect})
	return true
}

func (i *Importer) mergeSense(lex *entity.Lexeme, chineseGloss string) bool {
	changed := false
	var zhSenseIdx int = -1
	for j := range lex.Senses {
		if lex.Senses[j].Language == entity.LanguageChinese && strings.TrimSpace(lex.Senses[j].Gloss) == strings.TrimSpace(chineseGloss) {
			zhSenseIdx = j
			break
		}
	}
	if zhSenseIdx == -1 {
		for j := range lex.Senses {
			if lex.Senses[j].Language == entity.LanguageChinese {
				zhSenseIdx = j
				break
			}
		}
	}
	if zhSenseIdx == -1 {
		lex.Senses = append(lex.Senses, entity.LexemeSense{
			Language: entity.LanguageChinese,
			Gloss:    chineseGloss,
		})
		changed = true
	}
	return changed
}

func (i *Importer) calculateCompleteness(lex *entity.Lexeme) int32 {
	score := int32(10)
	hasEn, hasZh := false, false
	for _, s := range lex.Senses {
		if s.Language == entity.LanguageEnglish && s.Gloss != "" {
			hasEn = true
		}
		if s.Language == entity.LanguageChinese && s.Gloss != "" {
			hasZh = true
		}
	}
	if hasEn {
		score += 20
	}
	if hasZh {
		score += 30
	}
	if len(lex.Relations) > 0 {
		score += 20
	}
	if score > 100 {
		score = 100
	}
	return score
}

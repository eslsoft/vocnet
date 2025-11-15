package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"
	"github.com/schollz/progressbar/v3"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
)

type wikidataStage struct {
	filePath       string
	limit          int
	batchSize      int
	requestTimeout time.Duration
	report         *ImportReport
	reportMu       sync.Mutex // Protects concurrent access to report
}

func newWikidataStage(cfg pipelineConfig) *wikidataStage {
	return &wikidataStage{
		filePath:       cfg.wikidataFile,
		limit:          cfg.wikidataLimit,
		batchSize:      cfg.batchSize,
		requestTimeout: cfg.requestTimeout,
		report:         NewImportReport("Wikidata"),
	}
}

func (s *wikidataStage) Name() string { return "wikidata" }

func (s *wikidataStage) Run(ctx context.Context, client dictv1connect.DictServiceClient) (*ImportReport, error) {
	log.Println("[wikidata] Starting Wikidata import stage")

	lexemes, err := s.loadLexemes()
	if err != nil {
		return s.report, err
	}
	if len(lexemes) == 0 {
		log.Printf("[wikidata] no lexemes found in %s", s.filePath)
		s.report.Finalize()
		return s.report, nil
	}

	s.report.Statistics.Total = int64(len(lexemes))

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

	jobCh := make(chan wikidataJob, s.batchSize*2)
	resultCh := make(chan wikidataResult, s.batchSize*2)
	var wg sync.WaitGroup

	var succeeded, failed, skipped int64

	// Start workers
	for i := 0; i < s.batchSize; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for job := range jobCh {
				reqCtx, cancel := context.WithTimeout(ctx, s.requestTimeout)
				err := s.createOrUpdate(reqCtx, client, job.lexeme)
				cancel()

				result := wikidataResult{
					id:     job.id,
					lemma:  job.lemma,
					lexeme: job.lexeme,
					err:    err,
				}
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
			// Update progress bar
			bar.Add(1)

			if result.err != nil {
				atomic.AddInt64(&failed, 1)
				s.reportMu.Lock()
				s.report.AddFailureSample(result.lemma, "api_error", result.err.Error())
				s.report.AddAPIError(result.lemma, result.err.Error())
				s.reportMu.Unlock()
				log.Printf("[wikidata] failed to upsert %s (%s): %v", result.id, result.lemma, result.err)
				// Show error on screen
				Warn("[wikidata] failed to upsert %s: %v", result.lemma, result.err)
			} else {
				atomic.AddInt64(&succeeded, 1)

				// Add success sample (first 10)
				formStrs := make([]string, 0, len(result.lexeme.RelatedForms))
				for _, form := range result.lexeme.RelatedForms {
					formStrs = append(formStrs, form.Term)
				}
				hasPhonetic := len(result.lexeme.Phonetics) > 0

				s.reportMu.Lock()
				s.report.AddSuccessSample(result.lemma, formStrs, hasPhonetic, false)

				// Record form statistics
				for _, form := range result.lexeme.RelatedForms {
					s.report.Statistics.TotalForms++
					if form.Irregular {
						s.report.Statistics.IrregularForms++
					} else {
						s.report.Statistics.RegularForms++
					}
					s.report.RecordFormType(form.FormType.String())
				}

				// Data quality metrics
				if hasPhonetic {
					s.report.Statistics.WithPhonetics++
				}
				if len(result.lexeme.Meanings) > 0 {
					s.report.Statistics.WithDefinitions++
				}
				if len(result.lexeme.Categories) > 0 {
					s.report.Statistics.WithCategories++
				}
				s.reportMu.Unlock()
			}
		}
	}()

	// Process lexemes
	for idx, raw := range lexemes {
		lexeme, err := convertWikidataLexeme(raw)
		if err != nil {
			atomic.AddInt64(&skipped, 1)
			s.reportMu.Lock()
			s.report.Statistics.Skipped++
			s.report.AddSkippedSample(raw.ID, err.Error())
			s.reportMu.Unlock()
			log.Printf("[wikidata] skipping %s: %v", raw.ID, err)
			// Update progress for skipped items
			bar.Add(1)
			continue
		}

		if idx < 3 {
			meanings := lexeme.GetMeanings()
			log.Printf("[wikidata] DEBUG %s: %d meanings", raw.ID, len(meanings))
			for i, meaning := range meanings {
				defs := meaning.GetDefinitions()
				log.Printf("  Meaning[%d]: POS=%s, %d definitions", i, meaning.GetPos(), len(defs))
				for j, def := range defs {
					log.Printf("    Definition[%d]: lang=%s, gloss=%s", j, def.GetLanguage().String(), def.GetGloss())
				}
			}
		}

		jobCh <- wikidataJob{id: raw.ID, lemma: lemmaText(lexeme), lexeme: lexeme}
	}

	close(jobCh)
	wg.Wait()
	close(resultCh)
	collectorWg.Wait()

	// Ensure progress bar is finished
	bar.Finish()

	// Update final statistics
	s.report.Statistics.Successful = succeeded
	s.report.Statistics.Failed = failed

	log.Printf("[wikidata] done. succeeded=%d skipped=%d failed=%d total=%d",
		succeeded, skipped, failed, len(lexemes))

	// Print summary to screen
	fmt.Printf("✓ Wikidata: %d succeeded, %d skipped, %d failed (total: %d)\n",
		succeeded, skipped, failed, len(lexemes))

	// Finalize report
	s.report.Finalize()

	// Print summary to log
	s.report.PrintSummary()

	// Save report to file
	reportPath := "reports/wikidata_import_report.json"
	if err := s.report.SaveToFile(reportPath); err != nil {
		log.Printf("[wikidata] Warning: failed to save report to %s: %v", reportPath, err)
		Warn("[wikidata] Failed to save report: %v", err)
	} else {
		log.Printf("[wikidata] Report saved to %s", reportPath)
	}

	if failed > 0 {
		Warn("Wikidata stage encountered %d failures", failed)
		return s.report, fmt.Errorf("wikidata stage encountered %d failures", failed)
	}
	return s.report, nil
}

func (s *wikidataStage) loadLexemes() ([]WikidataLexeme, error) {
	path, err := expandHome(s.filePath)
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
	if s.limit > 0 && len(lexemes) > s.limit {
		lexemes = lexemes[:s.limit]
	}
	return lexemes, nil
}

func (s *wikidataStage) createOrUpdate(ctx context.Context, client dictv1connect.DictServiceClient, newWord *dictv1.Word) error {
	// Try to create first
	req := connect.NewRequest(&dictv1.CreateWordRequest{Word: newWord})
	resp, err := client.CreateWord(ctx, req)
	if err != nil {
		// If already exists, merge with existing
		// Note: We check both the connect code and the error message because
		// Connect-RPC error propagation can sometimes wrap the original error code
		errCode := connect.CodeOf(err)
		isAlreadyExists := errCode == connect.CodeAlreadyExists ||
			strings.Contains(err.Error(), "AlreadyExists") ||
			strings.Contains(err.Error(), "word already exists")

		if !isAlreadyExists {
			return err
		}

		log.Printf("[wikidata] Word %s already exists, merging...", lemmaText(newWord))

		// Lookup existing word by lemma
		lookupReq := connect.NewRequest(&dictv1.LookupWordRequest{Word: lemmaText(newWord)})
		lookupResp, lookupErr := client.LookupWord(ctx, lookupReq)
		if lookupErr != nil {
			return fmt.Errorf("lookup existing word: %w", lookupErr)
		}

		existingWord := lookupResp.Msg
		if existingWord == nil {
			return fmt.Errorf("existing word not found after AlreadyExists error")
		}

		log.Printf("[wikidata] Existing word has %d meanings, new has %d", len(existingWord.GetMeanings()), len(newWord.GetMeanings()))

		// Merge new lexeme data into existing word
		merged := mergeWords(existingWord, newWord)

		log.Printf("[wikidata] Merged word has %d meanings", len(merged.GetMeanings()))

		// Update with merged data
		_, updateErr := client.UpdateWord(ctx, connect.NewRequest(merged))
		if updateErr != nil {
			return fmt.Errorf("update merged word: %w", updateErr)
		}

		return nil
	}
	log.Printf("[wikidata] Created word %s with %d meanings", lemmaText(resp.Msg), len(resp.Msg.GetMeanings()))
	return nil
}

// mergeWords merges newWord's definitions and forms into existingWord
func mergeWords(existing, incoming *dictv1.Word) *dictv1.Word {
	if existing == nil {
		return incoming
	}
	if incoming == nil {
		return existing
	}

	merged := &dictv1.Word{
		Id:           existing.GetId(),
		Term:         existing.GetTerm(),
		TermType:     existing.GetTermType(),
		Lemma:        existing.Lemma,
		Language:     existing.GetLanguage(),
		Irregular:    existing.GetIrregular() || incoming.GetIrregular(),
		Completeness: existing.GetCompleteness(),
		CreatedAt:    existing.GetCreatedAt(),
		UpdatedAt:    existing.GetUpdatedAt(),
	}

	if incoming.GetCompleteness() > merged.GetCompleteness() {
		merged.Completeness = incoming.GetCompleteness()
	}

	merged.Phonetics = mergePhonetics(existing.GetPhonetics(), incoming.GetPhonetics())
	merged.Categories = mergeCategories(existing.GetCategories(), incoming.GetCategories())
	merged.RelatedForms = mergeRelatedForms(existing.GetRelatedForms(), incoming.GetRelatedForms())
	merged.Meanings = mergeMeanings(existing.GetMeanings(), incoming.GetMeanings())
	merged.Phrases = mergePhrases(existing.GetPhrases(), incoming.GetPhrases())

	return merged
}

func mergePhonetics(existing, incoming []*dictv1.Phonetic) []*dictv1.Phonetic {
	if len(existing) == 0 && len(incoming) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(existing)+len(incoming))
	out := make([]*dictv1.Phonetic, 0, len(existing)+len(incoming))
	for _, p := range existing {
		if p == nil {
			continue
		}
		key := phoneticKey(p)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, p)
	}
	for _, p := range incoming {
		if p == nil {
			continue
		}
		key := phoneticKey(p)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, p)
	}
	return out
}

func mergeCategories(existing, incoming []string) []string {
	if len(existing) == 0 && len(incoming) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(existing)+len(incoming))
	out := make([]string, 0, len(existing)+len(incoming))
	for _, cat := range existing {
		if _, ok := seen[cat]; ok {
			continue
		}
		seen[cat] = struct{}{}
		out = append(out, cat)
	}
	for _, cat := range incoming {
		if _, ok := seen[cat]; ok {
			continue
		}
		seen[cat] = struct{}{}
		out = append(out, cat)
	}
	return out
}

func mergeRelatedForms(existing, incoming []*dictv1.RelatedForm) []*dictv1.RelatedForm {
	if len(existing) == 0 && len(incoming) == 0 {
		return nil
	}
	seen := make(map[string]*dictv1.RelatedForm, len(existing)+len(incoming))
	out := make([]*dictv1.RelatedForm, 0, len(existing)+len(incoming))
	for _, form := range existing {
		if form == nil {
			continue
		}
		key := relatedFormKey(form)
		if key == "" {
			continue
		}
		if existingForm, ok := seen[key]; ok {
			if form.GetIrregular() && !existingForm.GetIrregular() {
				existingForm.Irregular = true
			}
			continue
		}
		clone := &dictv1.RelatedForm{
			Term:      form.GetTerm(),
			FormType:  form.GetFormType(),
			Irregular: form.GetIrregular(),
		}
		seen[key] = clone
		out = append(out, clone)
	}
	for _, form := range incoming {
		if form == nil {
			continue
		}
		key := relatedFormKey(form)
		if key == "" {
			continue
		}
		if existingForm, ok := seen[key]; ok {
			if form.GetIrregular() && !existingForm.GetIrregular() {
				existingForm.Irregular = true
			}
			continue
		}
		clone := &dictv1.RelatedForm{
			Term:      form.GetTerm(),
			FormType:  form.GetFormType(),
			Irregular: form.GetIrregular(),
		}
		seen[key] = clone
		out = append(out, clone)
	}
	return out
}

func mergePhrases(existing, incoming []*dictv1.Phrase) []*dictv1.Phrase {
	if len(existing) == 0 && len(incoming) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(existing)+len(incoming))
	out := make([]*dictv1.Phrase, 0, len(existing)+len(incoming))
	for _, phrase := range existing {
		if phrase == nil {
			continue
		}
		key := fmt.Sprintf("%v", phrase)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, phrase)
	}
	for _, phrase := range incoming {
		if phrase == nil {
			continue
		}
		key := fmt.Sprintf("%v", phrase)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, phrase)
	}
	return out
}

func mergeMeanings(existing, incoming []*dictv1.Meaning) []*dictv1.Meaning {
	if len(existing) == 0 && len(incoming) == 0 {
		return nil
	}
	out := make([]*dictv1.Meaning, 0, len(existing)+len(incoming))
	byLexeme := make(map[string]*dictv1.Meaning)
	byPOS := make(map[string]int)

	for _, meaning := range existing {
		if meaning == nil {
			continue
		}
		out = append(out, meaning)
		if id := strings.TrimSpace(meaning.GetLexemeId()); id != "" {
			byLexeme[id] = meaning
		}
		posKey := normalizePOSForMatching(meaning.GetPos())
		if _, ok := byPOS[posKey]; !ok && posKey != "" {
			byPOS[posKey] = len(out) - 1
		}
	}

	for _, meaning := range incoming {
		if meaning == nil {
			continue
		}
		id := strings.TrimSpace(meaning.GetLexemeId())
		if id != "" && !isTemporaryLexemeID(id) {
			if target, ok := byLexeme[id]; ok {
				mergeMeaningDefinitions(target, meaning)
				continue
			}
		}

		posKey := normalizePOSForMatching(meaning.GetPos())
		if isTemporaryLexemeID(id) {
			if idx, ok := byPOS[posKey]; ok {
				mergeMeaningDefinitions(out[idx], meaning)
				continue
			}
		}

		if id != "" && !isTemporaryLexemeID(id) {
			replaced := false
			for idx, target := range out {
				if target == nil {
					continue
				}
				if isTemporaryLexemeID(target.GetLexemeId()) &&
					normalizePOSForMatching(target.GetPos()) == posKey {
					merged := cloneMeaning(meaning)
					mergeMeaningDefinitions(merged, target)
					out[idx] = merged
					byLexeme[id] = merged
					byPOS[posKey] = idx
					replaced = true
					break
				}
			}
			if replaced {
				continue
			}
		}

		cloned := cloneMeaning(meaning)
		out = append(out, cloned)
		if id := strings.TrimSpace(cloned.GetLexemeId()); id != "" {
			if !isTemporaryLexemeID(id) {
				byLexeme[id] = cloned
			}
		}
		if _, ok := byPOS[posKey]; !ok && posKey != "" {
			byPOS[posKey] = len(out) - 1
		}
	}

	return out
}

func mergeMeaningDefinitions(target, source *dictv1.Meaning) {
	if target == nil || source == nil {
		return
	}
	posKey := normalizePOSForMatching(target.GetPos())
	existing := make(map[string]struct{}, len(target.GetDefinitions()))
	for _, def := range target.GetDefinitions() {
		existing[senseKey(def.GetLanguage(), posKey, def.GetGloss())] = struct{}{}
	}
	for _, def := range source.GetDefinitions() {
		key := senseKey(def.GetLanguage(), posKey, def.GetGloss())
		if _, ok := existing[key]; ok {
			continue
		}
		target.Definitions = append(target.Definitions, &dictv1.Definition{
			Language: def.GetLanguage(),
			Gloss:    def.GetGloss(),
		})
		existing[key] = struct{}{}
	}

	if len(target.GetExamples()) == 0 && len(source.GetExamples()) > 0 {
		target.Examples = cloneExamples(source.GetExamples())
	}
	if len(source.GetRelations()) > 0 {
		target.Relations = mergeMeaningRelations(target.GetRelations(), source.GetRelations())
	}
}

func mergeMeaningRelations(existing, incoming []*dictv1.Relation) []*dictv1.Relation {
	if len(existing) == 0 && len(incoming) == 0 {
		return nil
	}
	out := make([]*dictv1.Relation, 0, len(existing)+len(incoming))
	seen := make(map[string]struct{}, len(existing)+len(incoming))
	for _, rel := range existing {
		if rel == nil {
			continue
		}
		key := relationKey(rel)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, rel)
	}
	for _, rel := range incoming {
		if rel == nil {
			continue
		}
		key := relationKey(rel)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, cloneRelation(rel))
	}
	return out
}

func relationKey(rel *dictv1.Relation) string {
	if rel == nil {
		return ""
	}
	return fmt.Sprintf("%d|%s|%s", rel.GetType(), strings.ToLower(strings.TrimSpace(rel.GetTargetWord())), strings.ToLower(strings.TrimSpace(rel.GetNote())))
}

func cloneMeaning(m *dictv1.Meaning) *dictv1.Meaning {
	if m == nil {
		return nil
	}
	clone := &dictv1.Meaning{
		LexemeId: m.GetLexemeId(),
		Pos:      m.GetPos(),
	}
	if len(m.GetDefinitions()) > 0 {
		clone.Definitions = cloneDefinitions(m.GetDefinitions())
	}
	if len(m.GetExamples()) > 0 {
		clone.Examples = cloneExamples(m.GetExamples())
	}
	if len(m.GetRelations()) > 0 {
		clone.Relations = cloneRelations(m.GetRelations())
	}
	return clone
}

func cloneDefinitions(defs []*dictv1.Definition) []*dictv1.Definition {
	out := make([]*dictv1.Definition, 0, len(defs))
	for _, def := range defs {
		if def == nil {
			continue
		}
		out = append(out, &dictv1.Definition{
			Language: def.GetLanguage(),
			Gloss:    def.GetGloss(),
		})
	}
	return out
}

func cloneExamples(examples []*dictv1.Sentence) []*dictv1.Sentence {
	out := make([]*dictv1.Sentence, 0, len(examples))
	for _, ex := range examples {
		if ex == nil {
			continue
		}
		out = append(out, &dictv1.Sentence{
			Text:      ex.GetText(),
			Source:    ex.GetSource(),
			SourceRef: ex.GetSourceRef(),
		})
	}
	return out
}

func cloneRelations(relations []*dictv1.Relation) []*dictv1.Relation {
	out := make([]*dictv1.Relation, 0, len(relations))
	for _, rel := range relations {
		if rel == nil {
			continue
		}
		clone := &dictv1.Relation{
			Type:       rel.GetType(),
			TargetWord: rel.GetTargetWord(),
		}
		if rel.Note != nil {
			note := rel.GetNote()
			clone.Note = &note
		}
		out = append(out, clone)
	}
	return out
}

func cloneRelation(rel *dictv1.Relation) *dictv1.Relation {
	if rel == nil {
		return nil
	}
	clone := &dictv1.Relation{
		Type:       rel.GetType(),
		TargetWord: rel.GetTargetWord(),
	}
	if rel.Note != nil {
		note := rel.GetNote()
		clone.Note = &note
	}
	return clone
}

func isTemporaryLexemeID(id string) bool {
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(id)), "TL-")
}

type wikidataJob struct {
	id     string
	lemma  string
	lexeme *dictv1.Word
}

type wikidataResult struct {
	id     string
	lemma  string
	lexeme *dictv1.Word
	err    error
}

// WikidataLexeme mirrors the dump structure for lexemes.
type WikidataLexeme struct {
	Type            string                     `json:"type"`
	ID              string                     `json:"id"`
	Language        string                     `json:"language"`
	LexicalCategory string                     `json:"lexicalCategory"`
	Lemmas          map[string]WikidataValue   `json:"lemmas"`
	Forms           []WikidataForm             `json:"forms"`
	Senses          []WikidataSense            `json:"senses"`
	Claims          map[string][]WikidataClaim `json:"claims"`
}

type WikidataValue struct {
	Language string `json:"language"`
	Value    string `json:"value"`
}

type WikidataForm struct {
	ID                  string                     `json:"id"`
	Representations     map[string]WikidataValue   `json:"representations"`
	GrammaticalFeatures []string                   `json:"grammaticalFeatures"`
	Claims              map[string][]WikidataClaim `json:"claims"`
}

type WikidataSense struct {
	ID      string                     `json:"id"`
	Glosses map[string]WikidataValue   `json:"glosses"`
	Claims  map[string][]WikidataClaim `json:"claims"`
}

type WikidataClaim struct {
	MainSnak struct {
		Property  string `json:"property"`
		DataValue struct {
			Value interface{} `json:"value"`
			Type  string      `json:"type"`
		} `json:"datavalue"`
	} `json:"mainsnak"`
}

func convertWikidataLexeme(wd WikidataLexeme) (*dictv1.Word, error) {
	lemma := extractLemma(wd.Lemmas)
	if lemma == "" {
		return nil, errors.New("lemma missing")
	}

	// wd.ID is the Wikidata Lexeme ID (e.g., "L123456")
	lexemeID := wd.ID

	formMap := make(map[string]*dictv1.RelatedForm)
	for _, form := range wd.Forms {
		converted, err := convertWikidataForm(lemma, form)
		if err != nil {
			continue
		}
		text := strings.ToLower(strings.TrimSpace(converted.GetTerm()))
		if text == "" || strings.EqualFold(text, strings.ToLower(strings.TrimSpace(lemma))) {
			continue
		}
		if existing, ok := formMap[text]; ok {
			if existing.GetFormType() == dictv1.FormType_FORM_TYPE_UNSPECIFIED &&
				converted.GetFormType() != dictv1.FormType_FORM_TYPE_UNSPECIFIED {
				formMap[text] = converted
			} else if converted.GetIrregular() && !existing.GetIrregular() {
				formMap[text] = converted
			}
		} else {
			formMap[text] = converted
		}
	}

	forms := make([]*dictv1.RelatedForm, 0, len(formMap))
	for _, form := range formMap {
		forms = append(forms, form)
	}

	posLabel := mapLexicalCategoryToPOS(wd.LexicalCategory)

	senses := make([]*dictv1.Definition, 0, len(wd.Senses))
	for _, sense := range wd.Senses {
		if converted := convertWikidataSense(sense); converted != nil {
			senses = append(senses, converted)
		}
	}

	// Check if this lexeme has any useful data
	// Allow import even without senses if it has forms or other valuable data
	hasUsefulData := len(senses) > 0 || len(forms) > 0 || posLabel != ""
	if !hasUsefulData {
		return nil, errors.New("no senses and no forms")
	}

	// Infer POS and categories from glosses if needed
	var categories []string
	if posLabel == "" && len(wd.Senses) > 0 {
		posAndCats := inferPOSAndCategories(wd.Senses)
		posLabel = posAndCats.POS
		categories = posAndCats.Categories
	}

	// Build meanings only if we have senses
	var meanings []*dictv1.Meaning
	if len(senses) > 0 {
		meanings = []*dictv1.Meaning{{
			LexemeId:    lexemeID,
			Pos:         posLabel,
			Definitions: senses,
		}}
	} else {
		// No senses, but we have forms - create a minimal meaning for the POS
		if posLabel != "" {
			meanings = []*dictv1.Meaning{{
				LexemeId:    lexemeID,
				Pos:         posLabel,
				Definitions: nil, // Will be enriched by ECDICT
			}}
		}
	}

	return &dictv1.Word{
		Term:         lemma,
		TermType:     dictv1.FormType_FORM_TYPE_LEMMA,
		Language:     commonv1.Language_LANGUAGE_ENGLISH,
		Categories:   categories,
		RelatedForms: forms,
		Meanings:     meanings,
	}, nil
}

func extractLemma(lemmas map[string]WikidataValue) string {
	for _, key := range []string{"en", "en-us", "en-gb"} {
		if lemma, ok := lemmas[key]; ok {
			return lemma.Value
		}
	}
	for _, value := range lemmas {
		return value.Value
	}
	return ""
}

func convertWikidataForm(lemma string, wdForm WikidataForm) (*dictv1.RelatedForm, error) {
	text := ""
	for _, key := range []string{"en", "en-us", "en-gb"} {
		if value, ok := wdForm.Representations[key]; ok {
			text = value.Value
			break
		}
	}
	if text == "" {
		for _, value := range wdForm.Representations {
			text = value.Value
			break
		}
	}
	if text == "" {
		return nil, errors.New("form text missing")
	}

	formType := mapGrammaticalFeaturesToFormType(wdForm.GrammaticalFeatures)

	// Detect if this form is irregular
	irregular := isIrregularForm(lemma, text, formType)

	return &dictv1.RelatedForm{
		Term:      text,
		FormType:  formType,
		Irregular: irregular,
	}, nil
}

func convertWikidataSense(wdSense WikidataSense) *dictv1.Definition {
	var gloss string
	var lang string
	for _, key := range []string{"en", "en-us", "en-gb"} {
		if value, ok := wdSense.Glosses[key]; ok {
			gloss = value.Value
			lang = key
			break
		}
	}
	if gloss == "" {
		for langKey, value := range wdSense.Glosses {
			gloss = value.Value
			lang = langKey
			break
		}
	}
	if gloss == "" {
		return nil
	}

	return &dictv1.Definition{
		Language: mapLanguageCode(lang),
		Gloss:    gloss,
	}
}

func mapGrammaticalFeaturesToFormType(features []string) dictv1.FormType {
	for _, feature := range features {
		switch feature {
		case "Q146786":
			return dictv1.FormType_FORM_TYPE_PLURAL
		case "Q1194697", "Q442485":
			return dictv1.FormType_FORM_TYPE_PAST
		case "Q1230649":
			return dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE
		case "Q10345583", "Q1923028":
			return dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE
		case "Q51929447", "Q51929074":
			return dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR
		case "Q14169499":
			return dictv1.FormType_FORM_TYPE_COMPARATIVE
		case "Q1817208":
			return dictv1.FormType_FORM_TYPE_SUPERLATIVE
		case "Q22716":
			return dictv1.FormType_FORM_TYPE_IMPERATIVE
		case "Q473746":
			return dictv1.FormType_FORM_TYPE_SUBJUNCTIVE
		}
	}
	return dictv1.FormType_FORM_TYPE_UNSPECIFIED
}

func mapLanguageCode(code string) commonv1.Language {
	switch code {
	case "en", "en-us", "en-gb":
		return commonv1.Language_LANGUAGE_ENGLISH
	case "zh", "zh-cn", "zh-hans", "zh-hant":
		return commonv1.Language_LANGUAGE_CHINESE
	case "es":
		return commonv1.Language_LANGUAGE_SPANISH
	case "fr":
		return commonv1.Language_LANGUAGE_FRENCH
	case "de":
		return commonv1.Language_LANGUAGE_GERMAN
	case "ja":
		return commonv1.Language_LANGUAGE_JAPANESE
	case "ko":
		return commonv1.Language_LANGUAGE_KOREAN
	default:
		return commonv1.Language_LANGUAGE_UNSPECIFIED
	}
}

func mapLexicalCategoryToPOS(lexicalCategory string) string {
	switch lexicalCategory {
	case "Q1084":
		return "noun"
	case "Q24905":
		return "verb"
	case "Q34698":
		return "adjective"
	case "Q380057":
		return "adverb"
	case "Q36224":
		return "pronoun"
	case "Q177545", "Q576271": // Q177545=numeral, Q576271=cardinal numeral
		return "numeral"
	case "Q10432772":
		return "preposition"
	case "Q83034":
		return "interjection"
	case "Q11471":
		return "article"
	case "Q814722": // determiner
		return "determiner"
	case "Q184943": // conjunction
		return "conjunction"
	default:
		return ""
	}
}

// POSAndCategories holds both POS and category tags inferred from glosses
type POSAndCategories struct {
	POS        string
	Categories []string
}

// inferPOSAndCategories attempts to infer the part-of-speech and category tags from sense glosses
// This is particularly useful for proper nouns and other words where Wikidata
// doesn't provide a lexicalCategory but the gloss contains clear indicators
func inferPOSAndCategories(senses []WikidataSense) POSAndCategories {
	// Collect all glosses
	var glosses []string
	for _, sense := range senses {
		for _, glossValue := range sense.Glosses {
			if glossValue.Value != "" {
				glosses = append(glosses, strings.ToLower(glossValue.Value))
			}
		}
	}

	if len(glosses) == 0 {
		return POSAndCategories{}
	}

	categories := []string{}

	// Check each gloss for patterns
	for _, gloss := range glosses {
		// Person names
		if strings.Contains(gloss, "family name") || strings.Contains(gloss, "surname") {
			categories = appendUnique(categories, "entity:person", "person:family-name")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "given name") || strings.Contains(gloss, "first name") {
			categories = appendUnique(categories, "entity:person", "person:given-name")
			if strings.Contains(gloss, "male") {
				categories = appendUnique(categories, "person:male-name")
			} else if strings.Contains(gloss, "female") {
				categories = appendUnique(categories, "person:female-name")
			} else if strings.Contains(gloss, "unisex") {
				categories = appendUnique(categories, "person:unisex-name")
			}
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}

		// Place names - specific types
		if strings.Contains(gloss, "city in") || strings.Contains(gloss, "city of") {
			categories = appendUnique(categories, "entity:place", "place:city")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		// Check for standalone "city" or patterns like "Canadian city"
		if (strings.Contains(gloss, " city") || strings.HasSuffix(gloss, "city")) &&
			!strings.Contains(gloss, "city in") && !strings.Contains(gloss, "city of") {
			categories = appendUnique(categories, "entity:place", "place:city")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "town in") || strings.Contains(gloss, "town of") {
			categories = appendUnique(categories, "entity:place", "place:town")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "village in") || strings.Contains(gloss, "village of") {
			categories = appendUnique(categories, "entity:place", "place:village")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "municipality in") {
			categories = appendUnique(categories, "entity:place", "place:municipality")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "capital of") {
			categories = appendUnique(categories, "entity:place", "place:capital", "place:city")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "state in") || strings.Contains(gloss, "american state") {
			categories = appendUnique(categories, "entity:place", "place:state")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "country") {
			categories = appendUnique(categories, "entity:place", "place:country")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "territory") {
			categories = appendUnique(categories, "entity:place", "place:territory")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "province") {
			categories = appendUnique(categories, "entity:place", "place:province")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "region") || strings.Contains(gloss, "historic land") {
			categories = appendUnique(categories, "entity:place", "place:region")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "river in") {
			categories = appendUnique(categories, "entity:place", "place:river")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "mountain") {
			categories = appendUnique(categories, "entity:place", "place:mountain")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "lake in") {
			categories = appendUnique(categories, "entity:place", "place:lake")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "island") {
			categories = appendUnique(categories, "entity:place", "place:island")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "place name") {
			categories = appendUnique(categories, "entity:place")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}

		// Demonyms (people from a place)
		if strings.Contains(gloss, "person from") || strings.Contains(gloss, "native of") ||
			strings.Contains(gloss, "resident of") || strings.Contains(gloss, "citizens or residents of") ||
			strings.Contains(gloss, "people of") {
			categories = appendUnique(categories, "attr:demonym")
			return POSAndCategories{POS: "noun", Categories: categories}
		}

		// Time-related
		if strings.Contains(gloss, "day after") || strings.Contains(gloss, "day of the week") {
			categories = appendUnique(categories, "entity:time", "attr:weekday")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "month of the year") {
			categories = appendUnique(categories, "entity:time", "attr:month")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}

		// Organizations
		if strings.Contains(gloss, "company") {
			categories = appendUnique(categories, "entity:organization", "org:company")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "organization") {
			categories = appendUnique(categories, "entity:organization")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "university") {
			categories = appendUnique(categories, "entity:organization", "org:university")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}

		// Products, Games, Media
		if strings.Contains(gloss, "video game") || strings.Contains(gloss, "web-based game") ||
			(strings.Contains(gloss, "game") && (strings.Contains(gloss, "created") || strings.Contains(gloss, "developed"))) {
			categories = appendUnique(categories, "product:game")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "software") || strings.Contains(gloss, "application") {
			categories = appendUnique(categories, "product:software")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "brand") {
			categories = appendUnique(categories, "product:brand")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}

		// Other entity types
		if strings.Contains(gloss, "language") {
			categories = appendUnique(categories, "entity:language")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "ethnic group") {
			categories = appendUnique(categories, "entity:ethnic-group")
			return POSAndCategories{POS: "proper-noun", Categories: categories}
		}
		if strings.Contains(gloss, "dog breed") {
			categories = appendUnique(categories, "attr:animal", "attr:dog-breed")
			return POSAndCategories{POS: "noun", Categories: categories}
		}
		if strings.Contains(gloss, "cat breed") {
			categories = appendUnique(categories, "attr:animal", "attr:cat-breed")
			return POSAndCategories{POS: "noun", Categories: categories}
		}

		// Scientific/Academic concepts
		if strings.Contains(gloss, "concept") || strings.Contains(gloss, "theory") ||
			strings.Contains(gloss, "principle") || strings.Contains(gloss, "hypothesis") {
			categories = appendUnique(categories, "attr:concept")
			return POSAndCategories{POS: "noun", Categories: categories}
		}

		// Phrases/idioms - typically don't have a single POS
		if strings.Contains(gloss, "phrase") || strings.Contains(gloss, "idiom") {
			categories = appendUnique(categories, "attr:phrase")
			// Don't return POS for phrases, continue checking
		}
		if strings.Contains(gloss, "saying") || strings.Contains(gloss, "proverb") {
			categories = appendUnique(categories, "phrase", "saying")
			// Don't return POS for sayings
		}
	}

	// If we only found phrase/saying categories, return them without POS
	if len(categories) > 0 {
		return POSAndCategories{POS: "", Categories: categories}
	}

	// No pattern matched
	return POSAndCategories{}
}

// inferPOSFromGlosses is kept for backward compatibility, now calls inferPOSAndCategories
func inferPOSFromGlosses(senses []WikidataSense) string {
	return inferPOSAndCategories(senses).POS
}

// appendUnique appends items to a slice only if they don't already exist
func appendUnique(slice []string, items ...string) []string {
	existing := make(map[string]bool)
	for _, item := range slice {
		existing[item] = true
	}
	for _, item := range items {
		if !existing[item] {
			slice = append(slice, item)
			existing[item] = true
		}
	}
	return slice
}

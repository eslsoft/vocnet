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
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
)

type wikidataStage struct {
	filePath       string
	limit          int
	batchSize      int
	requestTimeout time.Duration
	enricher       *ecdictEnricher
}

func newWikidataStage(cfg pipelineConfig, enricher *ecdictEnricher) *wikidataStage {
	return &wikidataStage{
		filePath:       cfg.wikidataFile,
		limit:          cfg.wikidataLimit,
		batchSize:      cfg.batchSize,
		requestTimeout: cfg.requestTimeout,
		enricher:       enricher,
	}
}

func (s *wikidataStage) Name() string { return "wikidata" }

func (s *wikidataStage) Run(ctx context.Context, client dictv1connect.DictServiceClient) error {
	lexemes, err := s.loadLexemes()
	if err != nil {
		return err
	}
	if len(lexemes) == 0 {
		log.Printf("[wikidata] no lexemes found in %s", s.filePath)
		return nil
	}

	jobCh := make(chan wikidataJob, s.batchSize*2)
	var wg sync.WaitGroup

	var succeeded, failed, skipped int64
	for i := 0; i < s.batchSize; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for job := range jobCh {
				reqCtx, cancel := context.WithTimeout(ctx, s.requestTimeout)
				err := s.createOrUpdate(reqCtx, client, job.lexeme)
				cancel()
				if err != nil {
					atomic.AddInt64(&failed, 1)
					log.Printf("[wikidata] worker %d failed to upsert %s (%s): %v", workerID, job.id, job.lemma, err)
				} else {
					atomic.AddInt64(&succeeded, 1)
				}
			}
		}(i + 1)
	}

	for idx, raw := range lexemes {
		lexeme, err := convertWikidataLexeme(raw)
		if err != nil {
			atomic.AddInt64(&skipped, 1)
			// Always log skipped lexemes for debugging
			log.Printf("[wikidata] skipping %s: %v", raw.ID, err)
			continue
		}
		if s.enricher != nil {
			// Register this word and all its forms as known from Wikidata
			s.enricher.RegisterWord(lexeme)
			// Then enrich it with ECDICT data if available
			s.enricher.Enrich(lexeme)
			// Re-register to include any new forms added by enrichment
			s.enricher.RegisterWord(lexeme)
		}
		// Debug: log the lexeme senses after enrichment
		if idx < 3 { // Only log first 3 for debugging
			log.Printf("[wikidata] DEBUG %s: %d definitions, senses:", raw.ID, len(lexeme.GetDefinitions()))
			for i, def := range lexeme.GetDefinitions() {
				log.Printf("  Definition[%d]: POS=%s, %d senses", i, def.GetPos(), len(def.GetSenses()))
				for j, sense := range def.GetSenses() {
					log.Printf("    Sense[%d]: lang=%s, gloss=%s", j, sense.GetLanguage(), sense.GetGloss())
				}
			}
		}
		jobCh <- wikidataJob{id: raw.ID, lemma: lexeme.GetLemma(), lexeme: lexeme}
		if (idx+1)%5000 == 0 {
			log.Printf("[wikidata] queued %d/%d lexemes", idx+1, len(lexemes))
		}
	}

	close(jobCh)
	wg.Wait()

	log.Printf("[wikidata] done. succeeded=%d skipped=%d failed=%d total=%d",
		succeeded, skipped, failed, len(lexemes))

	if failed > 0 {
		return fmt.Errorf("wikidata stage encountered %d failures", failed)
	}
	return nil
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

		log.Printf("[wikidata] Word %s already exists, merging...", newWord.GetLemma())

		// Lookup existing word by lemma
		lookupReq := connect.NewRequest(&dictv1.LookupWordRequest{Word: newWord.GetLemma()})
		lookupResp, lookupErr := client.LookupWord(ctx, lookupReq)
		if lookupErr != nil {
			return fmt.Errorf("lookup existing word: %w", lookupErr)
		}

		existingWord := lookupResp.Msg
		if existingWord == nil {
			return fmt.Errorf("existing word not found after AlreadyExists error")
		}

		log.Printf("[wikidata] Existing word has %d definitions, new has %d", len(existingWord.GetDefinitions()), len(newWord.GetDefinitions()))

		// Merge new lexeme data into existing word
		merged := mergeWords(existingWord, newWord)

		log.Printf("[wikidata] Merged word has %d definitions", len(merged.GetDefinitions()))

		// Update with merged data
		_, updateErr := client.UpdateWord(ctx, connect.NewRequest(merged))
		if updateErr != nil {
			return fmt.Errorf("update merged word: %w", updateErr)
		}

		return nil
	}
	log.Printf("[wikidata] Created word %s with %d definitions", resp.Msg.GetLemma(), len(resp.Msg.GetDefinitions()))
	return nil
}

// mergeWords merges newWord's definitions and forms into existingWord
func mergeWords(existing, new *dictv1.Word) *dictv1.Word {
	// Keep existing ID and metadata
	merged := &dictv1.Word{
		Id:           existing.GetId(),
		Lemma:        existing.GetLemma(),
		Language:     existing.GetLanguage(),
		Phonetics:    existing.GetPhonetics(),
		Categories:   existing.GetCategories(),
		Completeness: existing.GetCompleteness(),
		CreatedAt:    existing.GetCreatedAt(),
		UpdatedAt:    existing.GetUpdatedAt(),
	}

	// Merge phonetics (deduplicate by IPA+Dialect)
	phoneticMap := make(map[string]*dictv1.Phonetic)
	for _, p := range existing.GetPhonetics() {
		key := p.GetIpa() + "|" + p.GetDialect()
		phoneticMap[key] = p
	}
	for _, p := range new.GetPhonetics() {
		key := p.GetIpa() + "|" + p.GetDialect()
		if _, exists := phoneticMap[key]; !exists {
			phoneticMap[key] = p
		}
	}
	merged.Phonetics = make([]*dictv1.Phonetic, 0, len(phoneticMap))
	for _, p := range phoneticMap {
		merged.Phonetics = append(merged.Phonetics, p)
	}

	// Merge categories (deduplicate)
	catMap := make(map[string]bool)
	for _, cat := range existing.GetCategories() {
		catMap[cat] = true
	}
	for _, cat := range new.GetCategories() {
		catMap[cat] = true
	}
	merged.Categories = make([]string, 0, len(catMap))
	for cat := range catMap {
		merged.Categories = append(merged.Categories, cat)
	}

	// Merge forms (deduplicate by LexemeId+Word text)
	formMap := make(map[string]*dictv1.WordForm)
	for _, f := range existing.GetForms() {
		key := f.GetLexemeId() + "|" + strings.ToLower(f.GetWord())
		formMap[key] = f
	}
	for _, f := range new.GetForms() {
		key := f.GetLexemeId() + "|" + strings.ToLower(f.GetWord())
		if _, exists := formMap[key]; !exists {
			formMap[key] = f
		}
	}
	merged.Forms = make([]*dictv1.WordForm, 0, len(formMap))
	for _, f := range formMap {
		merged.Forms = append(merged.Forms, f)
	}

	// Merge definitions
	// Strategy:
	// - Wikidata lexemes (L prefix): keep separate by LexemeId+POS (same word can have multiple lexemes with same POS)
	// - ECDICT definitions (TL prefix): merge by POS into existing Wikidata definitions

	// Use LexemeId+POS as key to preserve Wikidata's multiple lexemes with same POS
	defMap := make(map[string]*dictv1.Definition)
	for _, def := range existing.GetDefinitions() {
		key := def.GetLexemeId() + "|" + strings.ToLower(strings.TrimSpace(def.GetPos()))
		defMap[key] = def
	}

	// Build a POS lookup map for ECDICT matching (only use first definition per POS)
	existingByPOS := make(map[string]*dictv1.Definition)
	for _, def := range existing.GetDefinitions() {
		posKey := strings.ToLower(strings.TrimSpace(def.GetPos()))
		if _, exists := existingByPOS[posKey]; !exists {
			// Only store the first definition for each POS
			existingByPOS[posKey] = def
		}
	}

	for _, newDef := range new.GetDefinitions() {
		newLexemeID := newDef.GetLexemeId()
		posKey := strings.ToLower(strings.TrimSpace(newDef.GetPos()))
		key := newLexemeID + "|" + posKey

		// Check if this is ECDICT data (TL prefix) or Wikidata data (L prefix)
		isECDICT := strings.HasPrefix(newLexemeID, "TL-")

		if isECDICT {
			// ECDICT definition: try to merge by POS into existing Wikidata definition
			if existingDef, exists := existingByPOS[posKey]; exists {
				// Found matching POS - merge senses into existing Wikidata definition
				senseMap := make(map[string]*dictv1.LexemeSense)
				for _, s := range existingDef.GetSenses() {
					senseKey := s.GetLanguage().String() + "|" + strings.ToLower(s.GetGloss())
					senseMap[senseKey] = s
				}
				for _, s := range newDef.GetSenses() {
					senseKey := s.GetLanguage().String() + "|" + strings.ToLower(s.GetGloss())
					if _, ok := senseMap[senseKey]; !ok {
						senseMap[senseKey] = s
					}
				}
				existingDef.Senses = make([]*dictv1.LexemeSense, 0, len(senseMap))
				for _, s := range senseMap {
					existingDef.Senses = append(existingDef.Senses, s)
				}
				// Don't add to defMap - senses were merged into existing definition
			} else {
				// No matching POS in existing - add ECDICT definition as new
				defMap[key] = newDef
			}
		} else {
			// Wikidata definition: use LexemeId+POS key (preserve multiple lexemes with same POS)
			if existingDef, exists := defMap[key]; exists {
				// Same LexemeId+POS - merge senses
				senseMap := make(map[string]*dictv1.LexemeSense)
				for _, s := range existingDef.GetSenses() {
					senseKey := s.GetLanguage().String() + "|" + strings.ToLower(s.GetGloss())
					senseMap[senseKey] = s
				}
				for _, s := range newDef.GetSenses() {
					senseKey := s.GetLanguage().String() + "|" + strings.ToLower(s.GetGloss())
					if _, ok := senseMap[senseKey]; !ok {
						senseMap[senseKey] = s
					}
				}
				existingDef.Senses = make([]*dictv1.LexemeSense, 0, len(senseMap))
				for _, s := range senseMap {
					existingDef.Senses = append(existingDef.Senses, s)
				}
			} else {
				// Check if there's a TL-xxx definition with the same POS
				// If so, replace it with this Wikidata definition (merge senses)
				var tlDefKey string
				for existingKey, existingDef := range defMap {
					if strings.HasPrefix(existingDef.GetLexemeId(), "TL-") &&
						strings.ToLower(strings.TrimSpace(existingDef.GetPos())) == posKey {
						tlDefKey = existingKey
						break
					}
				}

				if tlDefKey != "" {
					// Found TL-xxx definition with same POS - merge and replace
					tlDef := defMap[tlDefKey]
					senseMap := make(map[string]*dictv1.LexemeSense)
					// First add all senses from TL definition
					for _, s := range tlDef.GetSenses() {
						senseKey := s.GetLanguage().String() + "|" + strings.ToLower(s.GetGloss())
						senseMap[senseKey] = s
					}
					// Then add senses from new Wikidata definition
					for _, s := range newDef.GetSenses() {
						senseKey := s.GetLanguage().String() + "|" + strings.ToLower(s.GetGloss())
						if _, ok := senseMap[senseKey]; !ok {
							senseMap[senseKey] = s
						}
					}
					// Create merged definition with Wikidata LexemeId
					mergedSenses := make([]*dictv1.LexemeSense, 0, len(senseMap))
					for _, s := range senseMap {
						mergedSenses = append(mergedSenses, s)
					}
					newDef.Senses = mergedSenses
					// Remove TL definition and add Wikidata definition
					delete(defMap, tlDefKey)
					defMap[key] = newDef
				} else {
					// No TL-xxx definition with same POS - add as new definition
					defMap[key] = newDef
				}
			}
		}
	}

	merged.Definitions = make([]*dictv1.Definition, 0, len(defMap))
	for _, def := range defMap {
		merged.Definitions = append(merged.Definitions, def)
	}

	// Merge relations (deduplicate by word+relation type)
	relMap := make(map[string]*dictv1.WordRelation)
	for _, rel := range existing.GetRelations() {
		key := rel.GetWord() + "|" + rel.GetRelation().String()
		relMap[key] = rel
	}
	for _, rel := range new.GetRelations() {
		key := rel.GetWord() + "|" + rel.GetRelation().String()
		if _, exists := relMap[key]; !exists {
			relMap[key] = rel
		}
	}
	merged.Relations = make([]*dictv1.WordRelation, 0, len(relMap))
	for _, rel := range relMap {
		merged.Relations = append(merged.Relations, rel)
	}

	// Merge phrases (deduplicate by phrase text)
	phraseMap := make(map[string]*dictv1.Phrase)
	for _, phrase := range existing.GetPhrases() {
		// Use phrase.Text or some unique identifier
		key := fmt.Sprintf("%v", phrase) // Simple approach
		phraseMap[key] = phrase
	}
	for _, phrase := range new.GetPhrases() {
		key := fmt.Sprintf("%v", phrase)
		if _, exists := phraseMap[key]; !exists {
			phraseMap[key] = phrase
		}
	}
	merged.Phrases = make([]*dictv1.Phrase, 0, len(phraseMap))
	for _, phrase := range phraseMap {
		merged.Phrases = append(merged.Phrases, phrase)
	}

	return merged
}

type wikidataJob struct {
	id     string
	lemma  string
	lexeme *dictv1.Word
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

	// Use a map to deduplicate forms by text (lexeme_id + text must be unique)
	// Keep the first occurrence of each unique text
	formMap := make(map[string]*dictv1.WordForm)
	for _, form := range wd.Forms {
		converted, err := convertWikidataForm(form, lemma, lexemeID)
		if err != nil {
			continue
		}
		// Normalize the text for deduplication (case-sensitive as DB uses lowercase comparison)
		text := strings.ToLower(strings.TrimSpace(converted.Word))
		if text == "" {
			continue
		}
		// Only keep the first occurrence of each unique text
		// Prioritize LEMMA type if multiple forms have the same text
		if existing, ok := formMap[text]; ok {
			// Keep lemma form if either is lemma type
			if converted.Type == dictv1.FormType_FORM_TYPE_LEMMA {
				formMap[text] = converted
			} else if existing.Type != dictv1.FormType_FORM_TYPE_LEMMA {
				// Keep the first non-lemma form (arbitrary but consistent)
				continue
			}
		} else {
			formMap[text] = converted
		}
	}

	// Ensure lemma form exists
	lemmaText := strings.ToLower(strings.TrimSpace(lemma))
	if _, hasLemma := formMap[lemmaText]; !hasLemma {
		formMap[lemmaText] = &dictv1.WordForm{
			LexemeId: lexemeID,
			Word:     lemma,
			Type:     dictv1.FormType_FORM_TYPE_LEMMA,
		}
	}

	// Convert map to slice
	forms := make([]*dictv1.WordForm, 0, len(formMap))
	for _, form := range formMap {
		forms = append(forms, form)
	}

	posLabel := mapLexicalCategoryToPOS(wd.LexicalCategory)

	senses := make([]*dictv1.LexemeSense, 0, len(wd.Senses))
	for _, sense := range wd.Senses {
		if converted := convertWikidataSense(sense); converted != nil {
			senses = append(senses, converted)
		}
	}
	if len(senses) == 0 {
		return nil, errors.New("no senses")
	}

	// Infer POS and categories from glosses if needed
	var categories []string
	if posLabel == "" {
		posAndCats := inferPOSAndCategories(wd.Senses)
		posLabel = posAndCats.POS
		categories = posAndCats.Categories
	}

	definitions := []*dictv1.Definition{{
		LexemeId: lexemeID,
		Pos:      posLabel,
		Senses:   senses,
	}}

	return &dictv1.Word{
		Lemma:       lemma,
		Language:    commonv1.Language_LANGUAGE_ENGLISH,
		Categories:  categories,
		Forms:       forms,
		Definitions: definitions,
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

func convertWikidataForm(wdForm WikidataForm, lemma string, lexemeID string) (*dictv1.WordForm, error) {
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

	formType := mapGrammaticalFeaturesToFormType(wdForm.GrammaticalFeatures, text, lemma)
	return &dictv1.WordForm{
		LexemeId: lexemeID, // Use the parent Lexeme ID (e.g., "L123456")
		Word:     text,
		Type:     formType,
	}, nil
}

func convertWikidataSense(wdSense WikidataSense) *dictv1.LexemeSense {
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

	return &dictv1.LexemeSense{
		Language: mapLanguageCode(lang),
		Gloss:    gloss,
	}
}

func mapGrammaticalFeaturesToFormType(features []string, text, lemma string) dictv1.FormType {
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
	if strings.EqualFold(text, lemma) {
		return dictv1.FormType_FORM_TYPE_LEMMA
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

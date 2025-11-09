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
			if idx < 5 || idx%5000 == 0 {
				log.Printf("[wikidata] skipping %s: %v", raw.ID, err)
			}
			continue
		}
		if s.enricher != nil {
			s.enricher.Enrich(lexeme)
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

func (s *wikidataStage) createOrUpdate(ctx context.Context, client dictv1connect.DictServiceClient, lexeme *dictv1.Word) error {
	req := connect.NewRequest(&dictv1.CreateWordRequest{Word: lexeme})
	if _, err := client.CreateWord(ctx, req); err != nil {
		if connect.CodeOf(err) != connect.CodeAlreadyExists {
			return err
		}
		_, updateErr := client.UpdateWord(ctx, connect.NewRequest(lexeme))
		return updateErr
	}
	return nil
}

type wikidataJob struct {
	id     string
	lemma  string
	lexeme *dictv1.DictionaryEntry
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

func convertWikidataLexeme(wd WikidataLexeme) (*dictv1.DictionaryEntry, error) {
	lemma := extractLemma(wd.Lemmas)
	if lemma == "" {
		return nil, errors.New("lemma missing")
	}

	forms := make([]*dictv1.LexemeForm, 0, len(wd.Forms))
	for _, form := range wd.Forms {
		converted, err := convertWikidataForm(form, lemma)
		if err != nil {
			continue
		}
		forms = append(forms, converted)
	}
	if !hasLemmaForm(forms) {
		forms = append([]*dictv1.LexemeForm{{
			Id:       fmt.Sprintf("%s-lemma", sanitizeID(lemma)),
			Text:     lemma,
			FormType: dictv1.FormType_FORM_TYPE_LEMMA,
		}}, forms...)
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
	definitionID := fmt.Sprintf("wikidata-%s-def-1", strings.ToLower(wd.ID))
	definitions := []*dictv1.Definition{{
		Id:           definitionID,
		PartOfSpeech: posLabel,
		Senses:       senses,
	}}

	return &dictv1.DictionaryEntry{
		Id:          fmt.Sprintf("wikidata-%s", strings.ToLower(wd.ID)),
		Language:    commonv1.Language_LANGUAGE_ENGLISH,
		LexemeEntryType:   determineLexemeEntryType(wd.LexicalCategory),
		Lemma:       lemma,
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

func convertWikidataForm(wdForm WikidataForm, lemma string) (*dictv1.LexemeForm, error) {
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
	return &dictv1.LexemeForm{
		Id:       sanitizeID(strings.ToLower(wdForm.ID)),
		Text:     text,
		FormType: formType,
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
		Id:       sanitizeID(strings.ToLower(wdSense.ID)),
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

func determineLexemeEntryType(lexicalCategory string) dictv1.LexemeEntryType {
	switch lexicalCategory {
	case "Q134830", "Q4833830", "Q7250170":
		return dictv1.LexemeEntryType_ENTRY_TYPE_PHRASE
	default:
		return dictv1.LexemeEntryType_ENTRY_TYPE_WORD
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
	case "Q177545":
		return "numeral"
	case "Q10432772":
		return "preposition"
	case "Q83034":
		return "interjection"
	case "Q11471":
		return "article"
	default:
		return ""
	}
}

func hasLemmaForm(forms []*dictv1.LexemeForm) bool {
	for _, form := range forms {
		if form.FormType == dictv1.FormType_FORM_TYPE_LEMMA {
			return true
		}
	}
	return false
}

func sanitizeID(input string) string {
	input = strings.ReplaceAll(input, "-", "_")
	input = strings.ReplaceAll(input, "/", "_")
	return input
}

package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/wordbook"
)

type SenseCleaner struct {
	entClient *entdb.Client
	aiClient  *OpenAIClient
	config    config
}

func NewSenseCleaner(entClient *entdb.Client, aiClient *OpenAIClient, cfg config) *SenseCleaner {
	return &SenseCleaner{
		entClient: entClient,
		aiClient:  aiClient,
		config:    cfg,
	}
}

// WordData represents aggregated data for a single word
type WordData struct {
	Term    string          // The word (e.g., "run")
	Lexemes []*entdb.Lexeme // All lexemes for this word
}

func (sc *SenseCleaner) Run(ctx context.Context) (*CleaningReport, error) {
	report := sc.newCleaningReport()

	wb, err := sc.loadWordbook(ctx, report)
	if err != nil || wb == nil {
		return report, err
	}

	wordsToProcess := sc.collectWordsToProcess(wb.Terms)
	if len(wordsToProcess) == 0 {
		sc.finishReport(report)
		return report, nil
	}

	wordDataList := sc.buildWordDataList(ctx, wordsToProcess)
	if len(wordDataList) == 0 {
		sc.finishReport(report)
		return report, nil
	}

	sc.processWordDataList(ctx, report, wordDataList)
	sc.finishReport(report)

	return report, nil
}

func (sc *SenseCleaner) newCleaningReport() *CleaningReport {
	return &CleaningReport{
		StartTime: time.Now(),
		Examples:  []CleaningExample{},
		Errors:    []string{},
		Config: map[string]any{
			"batch_size":      sc.config.batchSize,
			"limit":           sc.config.limit,
			"offset":          sc.config.offset,
			"dry_run":         sc.config.dryRun,
			"language_filter": sc.config.languageFilter,
			"pos_filter":      sc.config.posFilter,
			"wordbook":        sc.config.wordbookName,
			"wordbook_id":     sc.config.wordbookID,
		},
	}
}

func (sc *SenseCleaner) loadWordbook(ctx context.Context, report *CleaningReport) (*entdb.Wordbook, error) {
	if sc.config.wordbookID > 0 {
		log.Printf("Querying wordbook by ID: %d", sc.config.wordbookID)
		wb, err := sc.entClient.Wordbook.Get(ctx, sc.config.wordbookID)
		if err != nil {
			return nil, fmt.Errorf("query wordbook by id %d: %w", sc.config.wordbookID, err)
		}
		if len(wb.Terms) == 0 {
			log.Printf("Warning: wordbook %q is empty", wb.Name)
			sc.finishReport(report)
			return nil, nil
		}
		log.Printf("Found %d words in wordbook %q", len(wb.Terms), wb.Name)
		return wb, nil
	}

	wordbookName := sc.config.wordbookName
	if wordbookName == "" {
		wordbookName = "CEFR-B1"
	}

	log.Printf("Querying wordbook by name (contains, case-insensitive): %s", wordbookName)
	wbs, err := sc.entClient.Wordbook.Query().
		Where(wordbook.NameContainsFold(wordbookName)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query wordbook %q: %w", wordbookName, err)
	}
	if len(wbs) == 0 {
		return nil, fmt.Errorf("wordbook not found: %q", wordbookName)
	}
	if len(wbs) > 1 {
		var names []string
		for _, wb := range wbs {
			names = append(names, wb.Name)
		}
		return nil, fmt.Errorf("multiple wordbooks match %q: %s (use --wordbook-id to choose one)", wordbookName, strings.Join(names, ", "))
	}

	wb := wbs[0]
	if len(wb.Terms) == 0 {
		log.Printf("Warning: wordbook %q is empty", wb.Name)
		sc.finishReport(report)
		return nil, nil
	}

	log.Printf("Found %d words in wordbook %q", len(wb.Terms), wb.Name)
	return wb, nil
}

func (sc *SenseCleaner) collectWordsToProcess(terms []string) []string {
	offset := sc.config.offset
	if offset < 0 {
		offset = 0
	}
	if offset >= len(terms) {
		log.Printf("Offset %d is beyond wordbook size %d; nothing to process", offset, len(terms))
		return nil
	}

	terms = terms[offset:]

	var wordsToProcess []string
	for _, term := range terms {
		normalizedTerm := strings.ToLower(strings.TrimSpace(term))
		if normalizedTerm == "" {
			continue
		}
		wordsToProcess = append(wordsToProcess, normalizedTerm)
	}

	if sc.config.limit > 0 && len(wordsToProcess) > sc.config.limit {
		wordsToProcess = wordsToProcess[:sc.config.limit]
	}

	log.Printf("Processing %d words (after filtering, offset %d)", len(wordsToProcess), offset)
	return wordsToProcess
}

func (sc *SenseCleaner) buildWordDataList(ctx context.Context, wordsToProcess []string) []*WordData {
	var wordDataList []*WordData
	for _, term := range wordsToProcess {
		lemmas, err := sc.entClient.Lemma.Query().
			Where(lemma.NormalizedEQ(term)).
			WithLexemes(func(q *entdb.LexemeQuery) {
				if sc.config.languageFilter != "" {
					q.Where(lexeme.LanguageCodeEQ(sc.config.languageFilter))
				}
				if sc.config.posFilter != "" {
					if parsedPOS, ok := entity.ParsePartOfSpeech(sc.config.posFilter); ok {
						q.Where(lexeme.PosEQ(parsedPOS))
					}
				}
				q.Where(func(s *sql.Selector) {
					s.Where(sql.NEQ(s.C(lexeme.FieldSenses), "[]"))
					s.Where(sql.NEQ(s.C(lexeme.FieldSenses), "null"))
				})
			}).
			All(ctx)
		if err != nil {
			log.Printf("Warning: failed to query lemmas for %q: %v", term, err)
			continue
		}

		lexemeMap := make(map[int64]*entdb.Lexeme)
		for _, lem := range lemmas {
			for _, lex := range lem.Edges.Lexemes {
				if lex != nil {
					lexemeMap[lex.ID] = lex
				}
			}
		}

		if len(lexemeMap) == 0 {
			continue
		}

		var lexemes []*entdb.Lexeme
		for _, lex := range lexemeMap {
			lexemes = append(lexemes, lex)
		}

		wordDataList = append(wordDataList, &WordData{
			Term:    term,
			Lexemes: lexemes,
		})
	}

	log.Printf("Found %d words with lexemes to process", len(wordDataList))
	return wordDataList
}

func (sc *SenseCleaner) processWordDataList(ctx context.Context, report *CleaningReport, wordDataList []*WordData) {
	var (
		mu           sync.Mutex
		wg           sync.WaitGroup
		semaphore    = make(chan struct{}, sc.config.batchSize)
		exampleCount = 0
	)

	for _, wordData := range wordDataList {
		wg.Add(1)
		semaphore <- struct{}{} // Acquire

		go func(wd *WordData) {
			defer wg.Done()
			defer func() { <-semaphore }() // Release

			result := sc.processWord(ctx, wd)

			mu.Lock()
			report.TotalProcessed++

			if result.Error != nil {
				report.Failed++
				report.Errors = append(report.Errors, fmt.Sprintf("[%s] %v", wd.Term, result.Error))
				log.Printf("Failed to clean %q: %v", wd.Term, result.Error)
			} else if result.Changed {
				report.SuccessfullyCleaned++
				report.SensesBefore += result.SensesBefore
				report.SensesAfter += result.SensesAfter

				if exampleCount < 10 && len(result.Examples) > 0 {
					report.Examples = append(report.Examples, result.Examples[0])
					exampleCount++
				}
			} else {
				report.Skipped++
			}

			if report.TotalProcessed%10 == 0 {
				log.Printf("Progress: %d/%d processed (cleaned: %d, skipped: %d, failed: %d)",
					report.TotalProcessed, len(wordDataList),
					report.SuccessfullyCleaned, report.Skipped, report.Failed)
			}
			mu.Unlock()
		}(wordData)
	}

	wg.Wait()
}

func (sc *SenseCleaner) finishReport(report *CleaningReport) {
	report.EndTime = time.Now()
	report.Duration = report.EndTime.Sub(report.StartTime).String()
}

type WordProcessResult struct {
	Changed      bool
	SensesBefore int
	SensesAfter  int
	Examples     []CleaningExample
	Error        error
}

func (sc *SenseCleaner) processWord(ctx context.Context, wordData *WordData) WordProcessResult {
	result := WordProcessResult{
		Examples: []CleaningExample{},
	}

	if len(wordData.Lexemes) == 0 {
		return result
	}

	// Prepare aggregated data for the word
	var allLexemeData []LexemeData
	totalSensesBefore := 0

	for _, lex := range wordData.Lexemes {
		totalSensesBefore += len(lex.Senses)
		allLexemeData = append(allLexemeData, LexemeData{
			LexemeID:   lex.ExternalID,
			POS:        string(lex.Pos),
			Senses:     lex.Senses,
			SenseGloss: lex.SenseGloss,
		})
	}

	result.SensesBefore = totalSensesBefore

	// Call OpenAI API to clean all lexemes of this word
	response, err := sc.aiClient.CleanWordSenses(ctx, CleanWordSensesRequest{
		Word:    wordData.Term,
		Lexemes: allLexemeData,
	})
	if err != nil {
		result.Error = fmt.Errorf("openai api: %w", err)
		return result
	}

	// Check if anything changed and update database
	changed := false
	totalSensesAfter := 0

	for _, cleanedLexeme := range response.Lexemes {
		// Find the corresponding lexeme in the original data
		var originalLexeme *entdb.Lexeme
		for _, lex := range wordData.Lexemes {
			if lex.ExternalID == cleanedLexeme.LexemeID {
				originalLexeme = lex
				break
			}
		}

		if originalLexeme == nil {
			log.Printf("Warning: cleaned lexeme %s not found in original data", cleanedLexeme.LexemeID)
			continue
		}

		totalSensesAfter += len(cleanedLexeme.Senses)

		// Check if this lexeme changed
		glossChanged := cleanedLexeme.SenseGloss != originalLexeme.SenseGloss
		sensesChanged := false

		if len(cleanedLexeme.Senses) != len(originalLexeme.Senses) {
			sensesChanged = true
		} else {
			// Deep comparison
			for i := range cleanedLexeme.Senses {
				if cleanedLexeme.Senses[i].Gloss != originalLexeme.Senses[i].Gloss {
					sensesChanged = true
					break
				}
			}
		}

		if !glossChanged && !sensesChanged {
			continue
		}

		changed = true

		// Add to examples
		if len(result.Examples) < 3 {
			result.Examples = append(result.Examples, CleaningExample{
				LexemeID:    originalLexeme.ExternalID,
				Lemma:       wordData.Term,
				POS:         string(originalLexeme.Pos),
				Before:      originalLexeme.Senses,
				After:       cleanedLexeme.Senses,
				BeforeGloss: originalLexeme.SenseGloss,
				AfterGloss:  cleanedLexeme.SenseGloss,
			})
		}

		// Update database if not dry run
		if !sc.config.dryRun {
			if err := sc.entClient.Lexeme.UpdateOneID(originalLexeme.ID).
				SetSenses(cleanedLexeme.Senses).
				SetSenseGloss(cleanedLexeme.SenseGloss).
				Exec(ctx); err != nil {
				result.Error = fmt.Errorf("update database for lexeme %s: %w", originalLexeme.ExternalID, err)
				return result
			}
		}
	}

	result.Changed = changed
	result.SensesAfter = totalSensesAfter

	return result
}

package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"entgo.io/ent/dialect/sql"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/wordbook"
)

type SenseCleaner struct {
	entClient    *entdb.Client
	claudeClient *ClaudeClient
	config       config
}

func NewSenseCleaner(entClient *entdb.Client, claudeClient *ClaudeClient, cfg config) *SenseCleaner {
	return &SenseCleaner{
		entClient:    entClient,
		claudeClient: claudeClient,
		config:       cfg,
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

	processedWords := sc.loadProcessedWordsForResume()
	wordsToProcess := sc.collectWordsToProcess(wb.Terms, processedWords)
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
			"dry_run":         sc.config.dryRun,
			"language_filter": sc.config.languageFilter,
			"pos_filter":      sc.config.posFilter,
			"resume":          sc.config.resume,
			"state_file":      sc.config.stateFile,
		},
	}
}

func (sc *SenseCleaner) loadWordbook(ctx context.Context, report *CleaningReport) (*entdb.Wordbook, error) {
	log.Printf("Querying CEFR-B1 wordbook...")
	wb, err := sc.entClient.Wordbook.Query().
		Where(wordbook.NameContainsFold("CEFR-B1")).
		First(ctx)
	if err != nil {
		return nil, fmt.Errorf("query CEFR-B1 wordbook: %w", err)
	}

	if len(wb.Terms) == 0 {
		log.Printf("Warning: CEFR-B1 wordbook is empty")
		sc.finishReport(report)
		return nil, nil
	}

	log.Printf("Found %d words in CEFR-B1 wordbook", len(wb.Terms))
	return wb, nil
}

func (sc *SenseCleaner) loadProcessedWordsForResume() map[string]bool {
	if !sc.config.resume {
		return nil
	}

	processedWords, err := loadProcessedWords(sc.config.stateFile)
	if err != nil {
		log.Printf("Warning: failed to load state file: %v (starting fresh)", err)
		return make(map[string]bool)
	}

	log.Printf("Loaded %d processed words from state file", len(processedWords))
	return processedWords
}

func (sc *SenseCleaner) collectWordsToProcess(terms []string, processedWords map[string]bool) []string {
	var wordsToProcess []string
	for _, term := range terms {
		normalizedTerm := strings.ToLower(strings.TrimSpace(term))
		if normalizedTerm == "" {
			continue
		}
		if sc.config.resume && processedWords != nil && processedWords[normalizedTerm] {
			continue
		}
		wordsToProcess = append(wordsToProcess, normalizedTerm)
	}

	if sc.config.limit > 0 && len(wordsToProcess) > sc.config.limit {
		wordsToProcess = wordsToProcess[:sc.config.limit]
	}

	log.Printf("Processing %d words (after filtering)", len(wordsToProcess))
	return wordsToProcess
}

func (sc *SenseCleaner) buildWordDataList(ctx context.Context, wordsToProcess []string) []*WordData {
	var wordDataList []*WordData
	for _, term := range wordsToProcess {
		lemmas, err := sc.entClient.Lemma.Query().
			Where(lemma.NormalizedEQ(term)).
			WithLexeme(func(q *entdb.LexemeQuery) {
				if sc.config.languageFilter != "" {
					q.Where(lexeme.LanguageCodeEQ(sc.config.languageFilter))
				}
				if sc.config.posFilter != "" {
					q.Where(lexeme.PosEQ(sc.config.posFilter))
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
			if lem.Edges.Lexeme != nil {
				lexemeMap[lem.Edges.Lexeme.ID] = lem.Edges.Lexeme
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
			} else if result.Changed {
				report.SuccessfullyCleaned++
				report.SensesBefore += result.SensesBefore
				report.SensesAfter += result.SensesAfter

				if sc.config.resume && !sc.config.dryRun {
					go func(term string) {
						if err := appendProcessedWord(sc.config.stateFile, term); err != nil {
							log.Printf("Warning: failed to save state: %v", err)
						}
					}(wd.Term)
				}

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
			POS:        lex.Pos,
			Senses:     lex.Senses,
			SenseGloss: lex.SenseGloss,
		})
	}

	result.SensesBefore = totalSensesBefore

	// Call Claude API to clean all lexemes of this word
	response, err := sc.claudeClient.CleanWordSenses(ctx, CleanWordSensesRequest{
		Word:    wordData.Term,
		Lexemes: allLexemeData,
	})
	if err != nil {
		result.Error = fmt.Errorf("claude api: %w", err)
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
				POS:         originalLexeme.Pos,
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

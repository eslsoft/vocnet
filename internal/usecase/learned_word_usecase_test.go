package usecase

import (
	"context"
	"testing"

	"github.com/golang/mock/gomock"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/mocks"
	"github.com/eslsoft/vocnet/internal/repository"
)

func TestLearnedWordUsecase_ListLearnedWords_SetsQueriedTerm(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// User queries for "learning" (a gerund/present participle)
	// The system should map it to "learn" (lemma) for storage lookup
	// But return "learning" as QueriedTerm in the result
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"learning"},
	}

	// Mock BatchLookupFormInfo: "learning" is a verb form with lemma "learn"
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"learning"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"learning": {
				{
					FormText:    "learning",
					FormType:    "PRESENT_PARTICIPLE",
					LemmaText:   "learn",
					IsIrregular: false,
				},
			},
		}, nil)

	// Mock repository List: should receive both surface term and mapped lemma
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Verify that SurfaceTerms includes both "learning" (surface) and "learn" (mapped)
			expectedTerms := []string{"learning", "learn"}
			if !containsAll(q.SurfaceTerms, expectedTerms) {
				t.Errorf("expected SurfaceTerms to contain %v, got %v", expectedTerms, q.SurfaceTerms)
			}

			// Return a learned word with Term="learn" (the stored lemma)
			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "learn",
					Language: entity.LanguageEnglish,
					Mastery: entity.MasteryBreakdown{
						Overall: 300,
					},
				},
			}, 1, nil
		})

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	// Verify that MatchedTerms contains the original query term "learning"
	result := results[0]
	if result.Term != "learn" {
		t.Errorf("expected Term=learn, got %s", result.Term)
	}
	if len(result.MatchedTerms) != 1 || result.MatchedTerms[0] != "learning" {
		t.Errorf("expected MatchedTerms=[learning], got %v", result.MatchedTerms)
	}
}

func TestLearnedWordUsecase_ListLearnedWords_MultipleQueryTerms(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// User queries for multiple forms: "learning", "went", "apples"
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"learning", "went", "apples"},
	}

	// Mock BatchLookupFormInfo
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"learning", "went", "apples"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"learning": {
				{
					FormText:    "learning",
					FormType:    "PRESENT_PARTICIPLE",
					LemmaText:   "learn",
					IsIrregular: false,
				},
			},
			"went": {
				{
					FormText:    "went",
					FormType:    "PAST_TENSE",
					LemmaText:   "go",
					IsIrregular: true, // irregular verb
				},
			},
			"apples": {
				{
					FormText:    "apples",
					FormType:    "PLURAL",
					LemmaText:   "apple",
					IsIrregular: false,
				},
			},
		}, nil)

	// Mock repository List
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Storage terms: "learn" (from learning), "went" (irregular), "apple" (from apples)
			// Return learned words matching these storage terms
			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "learn",
					Language: entity.LanguageEnglish,
				},
				{
					ID:       2,
					UserID:   userID,
					Term:     "went",
					Language: entity.LanguageEnglish,
				},
				{
					ID:       3,
					UserID:   userID,
					Term:     "apple",
					Language: entity.LanguageEnglish,
				},
			}, 3, nil
		})

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 3 {
		t.Fatalf("expected total=3, got %d", total)
	}

	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	// Verify MatchedTerms for each result
	expectedMapping := map[string][]string{
		"learn": {"learning"},
		"went":  {"went"},
		"apple": {"apples"},
	}

	for _, result := range results {
		expectedMatched, ok := expectedMapping[result.Term]
		if !ok {
			t.Errorf("unexpected result term: %s", result.Term)
			continue
		}
		if !equalStringSlices(result.MatchedTerms, expectedMatched) {
			t.Errorf("for term=%s, expected MatchedTerms=%v, got %v", result.Term, expectedMatched, result.MatchedTerms)
		}
	}
}

func TestLearnedWordUsecase_ListLearnedWords_NoSurfaceTerms(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// Query without SurfaceTerms
	query := &repository.ListLearnedWordQuery{
		UserID:   userID,
		Language: "en",
		Keyword:  "test",
	}

	// Mock repository List - no lexeme lookup should happen
	mockRepo.EXPECT().
		List(ctx, query).
		Return([]entity.LearnedWord{
			{
				ID:       1,
				UserID:   userID,
				Term:     "test",
				Language: entity.LanguageEnglish,
			},
		}, int64(1), nil)

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	// MatchedTerms should be empty when not querying by SurfaceTerms
	result := results[0]
	if len(result.MatchedTerms) != 0 {
		t.Errorf("expected empty MatchedTerms, got %v", result.MatchedTerms)
	}
}

func TestLearnedWordUsecase_ListLearnedWords_MultipleSurfacesMapToSameStorage(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// User queries for both "learning" and "learned" - both map to "learn"
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"learning", "learned"},
	}

	// Mock BatchLookupFormInfo
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"learning", "learned"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"learning": {
				{
					FormText:    "learning",
					FormType:    "PRESENT_PARTICIPLE",
					LemmaText:   "learn",
					IsIrregular: false,
				},
			},
			"learned": {
				{
					FormText:    "learned",
					FormType:    "PAST_TENSE",
					LemmaText:   "learn",
					IsIrregular: false,
				},
			},
		}, nil)

	// Mock repository List: should receive surface terms + mapped lemmas
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Verify that SurfaceTerms includes both surface terms and the mapped lemma
			// ["learning", "learn", "learned"] after deduplication
			expectedTerms := []string{"learning", "learn", "learned"}
			if !containsAll(q.SurfaceTerms, expectedTerms) {
				t.Errorf("expected SurfaceTerms to contain %v, got %v", expectedTerms, q.SurfaceTerms)
			}

			// Return a learned word with Term="learn"
			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "learn",
					Language: entity.LanguageEnglish,
				},
			}, 1, nil
		})

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	// MatchedTerms should contain both "learning" and "learned"
	result := results[0]
	if result.Term != "learn" {
		t.Errorf("expected Term=learn, got %s", result.Term)
	}
	expectedMatched := []string{"learning", "learned"}
	if !equalStringSlices(result.MatchedTerms, expectedMatched) {
		t.Errorf("expected MatchedTerms to contain both 'learning' and 'learned', got %v", result.MatchedTerms)
	}
}

func TestLearnedWordUsecase_ListLearnedWords_ExactMatchPriority(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// User queries for both "learn" and "learning"
	// "learn" is the lemma itself, "learning" is a form that maps to "learn"
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"learn", "learning"},
	}

	// Mock BatchLookupFormInfo
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"learn", "learning"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"learn": {
				{
					FormText:    "learn",
					FormType:    "LEMMA",
					LemmaText:   "learn",
					IsIrregular: false,
				},
			},
			"learning": {
				{
					FormText:    "learning",
					FormType:    "PRESENT_PARTICIPLE",
					LemmaText:   "learn",
					IsIrregular: false,
				},
			},
		}, nil)

	// Mock repository List
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Should receive both "learn" (surface + lemma) and "learning" (surface + maps to learn)
			expectedTerms := []string{"learn", "learning"}
			if !containsAll(q.SurfaceTerms, expectedTerms) {
				t.Errorf("expected SurfaceTerms to contain %v, got %v", expectedTerms, q.SurfaceTerms)
			}

			// Return the learned word for "learn"
			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "learn",
					Language: entity.LanguageEnglish,
				},
			}, 1, nil
		})

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	// MatchedTerms should contain both "learn" and "learning"
	result := results[0]
	if result.Term != "learn" {
		t.Errorf("expected Term=learn, got %s", result.Term)
	}
	expectedMatched := []string{"learn", "learning"}
	if !equalStringSlices(result.MatchedTerms, expectedMatched) {
		t.Errorf("expected MatchedTerms to contain both 'learn' and 'learning', got %v", result.MatchedTerms)
	}
}

func TestLearnedWordUsecase_ListLearnedWords_AmbiguousFormMultipleStorageTerms(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// "learning" can be both a verb form (→ learn) and a noun (→ learning itself)
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"learning"},
	}

	// Mock BatchLookupFormInfo: "learning" has two possible interpretations
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"learning"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"learning": {
				{
					FormText:    "learning",
					FormType:    "PRESENT_PARTICIPLE",
					LemmaText:   "learn",
					IsIrregular: false,
				},
				{
					FormText:    "learning",
					FormType:    "LEMMA",
					LemmaText:   "learning",
					IsIrregular: false,
				},
			},
		}, nil)

	// Mock repository List
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Should receive both "learn" and "learning" (deduplicated)
			expectedTerms := []string{"learn", "learning"}
			if !containsAll(q.SurfaceTerms, expectedTerms) {
				t.Errorf("expected SurfaceTerms to contain %v, got %v", expectedTerms, q.SurfaceTerms)
			}

			// Return both learned words
			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "learn",
					Language: entity.LanguageEnglish,
				},
				{
					ID:       2,
					UserID:   userID,
					Term:     "learning",
					Language: entity.LanguageEnglish,
				},
			}, 2, nil
		})

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 2 {
		t.Fatalf("expected total=2, got %d", total)
	}

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}

	// Both results should have MatchedTerms containing "learning"
	for _, result := range results {
		if len(result.MatchedTerms) != 1 || result.MatchedTerms[0] != "learning" {
			t.Errorf("for term=%s, expected MatchedTerms=[learning], got %v", result.Term, result.MatchedTerms)
		}
	}
}

func TestLearnedWordUsecase_ListLearnedWords_IrregularForm(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// "went" is an irregular past tense form that stores itself (not "go")
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"went"},
	}

	// Mock BatchLookupFormInfo
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"went"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"went": {
				{
					FormText:    "went",
					FormType:    "PAST_TENSE",
					LemmaText:   "go",
					IsIrregular: true, // Irregular form stores itself
				},
			},
		}, nil)

	// Mock repository List
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Irregular form should store "went", not "go"
			if !containsAll(q.SurfaceTerms, []string{"went"}) {
				t.Errorf("expected SurfaceTerms to contain 'went', got %v", q.SurfaceTerms)
			}

			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "went",
					Language: entity.LanguageEnglish,
				},
			}, 1, nil
		})

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	result := results[0]
	if result.Term != "went" {
		t.Errorf("expected Term=went, got %s", result.Term)
	}
	if len(result.MatchedTerms) != 1 || result.MatchedTerms[0] != "went" {
		t.Errorf("expected MatchedTerms=[went], got %v", result.MatchedTerms)
	}
}

func TestLearnedWordUsecase_ListLearnedWords_UnknownForm(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// Query for a word not in the lexeme database
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"unknownword"},
	}

	// Mock BatchLookupFormInfo: no form info found
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"unknownword"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{}, nil)

	// Mock repository List
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Unknown word should use itself as-is (case-insensitive)
			if !containsAll(q.SurfaceTerms, []string{"unknownword"}) {
				t.Errorf("expected SurfaceTerms to contain 'unknownword', got %v", q.SurfaceTerms)
			}

			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "unknownword",
					Language: entity.LanguageEnglish,
				},
			}, 1, nil
		})

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	result := results[0]
	if result.Term != "unknownword" {
		t.Errorf("expected Term=unknownword, got %s", result.Term)
	}
	if len(result.MatchedTerms) != 1 || result.MatchedTerms[0] != "unknownword" {
		t.Errorf("expected MatchedTerms=[unknownword], got %v", result.MatchedTerms)
	}
}

// Test for Fix 1: Multiple query terms should all appear in MatchedTerms
func TestLearnedWordUsecase_ListLearnedWords_MultipleMatchedTerms(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// User queries for ["apple", "apples"] - both should appear in MatchedTerms
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"apple", "apples"},
	}

	// Mock BatchLookupFormInfo
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"apple", "apples"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"apple": {
				{
					FormText:    "apple",
					FormType:    "LEMMA",
					LemmaText:   "apple",
					IsIrregular: false,
				},
			},
			"apples": {
				{
					FormText:    "apples",
					FormType:    "PLURAL",
					LemmaText:   "apple",
					IsIrregular: false,
				},
			},
		}, nil)

	// Mock repository List
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Should query for both "apple" (surface + lemma) and "apples" (surface + maps to apple)
			// After dedup: ["apple", "apples"]
			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "apple",
					Language: entity.LanguageEnglish,
				},
			}, 1, nil
		})

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	// Both "apple" and "apples" should be in MatchedTerms
	result := results[0]
	expectedMatched := []string{"apple", "apples"}
	if !equalStringSlices(result.MatchedTerms, expectedMatched) {
		t.Errorf("expected MatchedTerms to contain both 'apple' and 'apples', got %v", result.MatchedTerms)
	}
}

// Test for Fix 2: Surface term should always be included in query
func TestLearnedWordUsecase_MapSurfaceTermsToStorageTerms_IncludesSurfaceTerm(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo).(*learnedWordUsecase)

	ctx := context.Background()

	// "axes" can be plural of both "axis" and "axe"
	// When we collect "axes", we store it as-is (ambiguous, len(formInfos) != 1)
	// When we query "axes", we should search for ["axes", "axis", "axe"]
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"axes"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"axes": {
				{
					FormText:    "axes",
					FormType:    "PLURAL",
					LemmaText:   "axis",
					IsIrregular: false,
				},
				{
					FormText:    "axes",
					FormType:    "PLURAL",
					LemmaText:   "axe",
					IsIrregular: false,
				},
			},
		}, nil)

	mappedTerms, mapping, err := uc.MapSurfaceTermsToStorageTermsWithMapping(ctx, []string{"axes"}, entity.LanguageEnglish)
	if err != nil {
		t.Fatalf("MapSurfaceTermsToStorageTermsWithMapping returned error: %v", err)
	}

	// Should include "axes" itself plus mapped lemmas "axis" and "axe"
	expectedTerms := []string{"axes", "axis", "axe"}
	if !equalStringSlices(mappedTerms, expectedTerms) {
		t.Errorf("expected mapped terms to include surface term 'axes' and lemmas, got %v", mappedTerms)
	}
	if !equalStringSlices(mapping["axes"], expectedTerms) {
		t.Errorf("expected mapping to contain %v, got %v", expectedTerms, mapping["axes"])
	}
}

func TestLearnedWordUsecase_MapSurfaceTermsToStorageTerms_SkipsSelfReferencingLemma(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo).(*learnedWordUsecase)

	ctx := context.Background()

	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"Roots"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"Roots": {
				{
					FormText:    "Roots",
					FormType:    "LEMMA",
					LemmaText:   "roots",
					IsIrregular: false,
				},
				{
					FormText:    "Roots",
					FormType:    "PLURAL",
					LemmaText:   "root",
					IsIrregular: false,
				},
			},
		}, nil)

	mappedTerms, mapping, err := uc.MapSurfaceTermsToStorageTermsWithMapping(ctx, []string{"Roots"}, entity.LanguageEnglish)
	if err != nil {
		t.Fatalf("MapSurfaceTermsToStorageTermsWithMapping returned error: %v", err)
	}

	if !equalStringSlices(mappedTerms, []string{"roots", "root"}) {
		t.Errorf("expected mapped terms to deduplicate to 'roots' and 'root', got %v", mappedTerms)
	}

	// After simplification, all terms are lowercase for consistent queries
	expectedCandidates := []string{"roots", "root"}
	if !equalStringSlices(mapping["Roots"], expectedCandidates) {
		t.Errorf("expected surface mapping %v, got %v", expectedCandidates, mapping["Roots"])
	}
}

func TestLearnedWordUsecase_MapSurfaceTermsToStorageTerms_Irregular(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo).(*learnedWordUsecase)

	ctx := context.Background()

	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"went"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"went": {
				{
					FormText:    "went",
					FormType:    "PAST_TENSE",
					LemmaText:   "go",
					IsIrregular: true,
				},
			},
		}, nil)

	mappedTerms, mapping, err := uc.MapSurfaceTermsToStorageTermsWithMapping(ctx, []string{"went"}, entity.LanguageEnglish)
	if err != nil {
		t.Fatalf("MapSurfaceTermsToStorageTermsWithMapping returned error: %v", err)
	}

	if !equalStringSlices(mappedTerms, []string{"went"}) {
		t.Errorf("expected mapped terms to stay on irregular form, got %v", mappedTerms)
	}
	if !equalStringSlices(mapping["went"], []string{"went"}) {
		t.Errorf("expected mapping for irregular form to keep the surface term, got %v", mapping["went"])
	}
}

// Test for the actual bug case from matchedTerms-refactor-plan.md section 4.1
// This is a regression test for the original matchedTerms bug
func TestLearnedWordUsecase_ListLearnedWords_RegressionTest_MatchedTermsBug(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// Real bug case: these surface terms should all match and populate MatchedTerms
	surfaceTerms := []string{"governing", "hired", "Games", "sales", "searching", "does", "goes", "Roots"}
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: surfaceTerms,
	}

	// Mock lexeme lookup for all terms
	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, surfaceTerms, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"governing": {
				{FormText: "governing", FormType: "PRESENT_PARTICIPLE", LemmaText: "govern", IsIrregular: false},
			},
			"hired": {
				{FormText: "hired", FormType: "PAST_TENSE", LemmaText: "hire", IsIrregular: false},
			},
			"Games": {
				{FormText: "Games", FormType: "PLURAL", LemmaText: "game", IsIrregular: false},
			},
			"sales": {
				{FormText: "sales", FormType: "PLURAL", LemmaText: "sale", IsIrregular: false},
			},
			"searching": {
				{FormText: "searching", FormType: "PRESENT_PARTICIPLE", LemmaText: "search", IsIrregular: false},
			},
			"does": {
				// Multiple possible lemmas - should query all of them
				{FormText: "does", FormType: "THIRD_PERSON_SINGULAR", LemmaText: "do", IsIrregular: false},
				{FormText: "does", FormType: "PLURAL", LemmaText: "doe", IsIrregular: false}, // wrong data, but should handle gracefully
			},
			"goes": {
				{FormText: "goes", FormType: "THIRD_PERSON_SINGULAR", LemmaText: "go", IsIrregular: false},
				{FormText: "goes", FormType: "PLURAL", LemmaText: "goe", IsIrregular: false}, // wrong data
			},
			"Roots": {
				{FormText: "Roots", FormType: "LEMMA", LemmaText: "roots", IsIrregular: false}, // self-referencing, should skip
				{FormText: "Roots", FormType: "PLURAL", LemmaText: "root", IsIrregular: false},
			},
		}, nil)

	// Mock repo to return learned words
	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		Return([]entity.LearnedWord{
			{ID: 1, UserID: userID, Term: "govern", Language: entity.LanguageEnglish},
			{ID: 2, UserID: userID, Term: "hire", Language: entity.LanguageEnglish},
			{ID: 3, UserID: userID, Term: "game", Language: entity.LanguageEnglish},
			{ID: 4, UserID: userID, Term: "sale", Language: entity.LanguageEnglish},
			{ID: 5, UserID: userID, Term: "search", Language: entity.LanguageEnglish},
			{ID: 6, UserID: userID, Term: "do", Language: entity.LanguageEnglish},
			{ID: 7, UserID: userID, Term: "go", Language: entity.LanguageEnglish},
			{ID: 8, UserID: userID, Term: "root", Language: entity.LanguageEnglish},
		}, int64(8), nil)

	results, total, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if total != 8 {
		t.Fatalf("expected total=8, got %d", total)
	}

	// Verify that ALL results have non-empty MatchedTerms
	// This was the original bug: matchedTerms was empty
	expectedMatches := map[string][]string{
		"govern": {"governing"},
		"hire":   {"hired"},
		"game":   {"Games"},
		"sale":   {"sales"},
		"search": {"searching"},
		"do":     {"does"},
		"go":     {"goes"},
		"root":   {"Roots"},
	}

	for _, result := range results {
		expected, ok := expectedMatches[result.Term]
		if !ok {
			t.Errorf("unexpected result term: %s", result.Term)
			continue
		}

		if len(result.MatchedTerms) == 0 {
			t.Errorf("REGRESSION: term=%s has empty MatchedTerms (this was the original bug!)", result.Term)
		}

		if !equalStringSlices(result.MatchedTerms, expected) {
			t.Errorf("term=%s: expected MatchedTerms=%v, got %v", result.Term, expected, result.MatchedTerms)
		}
	}
}

//
//// Test case-sensitive word handling (Polish vs polish)
//func TestLearnedWordUsecase_ListLearnedWords_CaseSensitiveWord(t *testing.T) {
//	ctrl := gomock.NewController(t)
//	defer ctrl.Finish()
//
//	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
//	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
//	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)
//
//	ctx := context.Background()
//	userID := int64(1000)
//
//	// "Polish" (proper noun) vs "polish" (verb) - should be case-sensitive
//	query := &repository.ListLearnedWordQuery{
//		UserID:       userID,
//		Language:     "en",
//		SurfaceTerms: []string{"Polish"},
//	}
//
//	mockLexemeRepo.EXPECT().
//		BatchLookupFormInfo(ctx, []string{"Polish"}, entity.LanguageEnglish).
//		Return(map[string][]*repository.LexemeFormInfo{
//			"Polish": {
//				{FormText: "Polish", FormType: "LEMMA", LemmaText: "Polish", IsIrregular: false, Pos: "proper noun"},
//			},
//		}, nil)
//
//	mockRepo.EXPECT().
//		List(ctx, gomock.Any()).
//		Return([]entity.LearnedWord{
//			{
//				ID:            1,
//				UserID:        userID,
//				Term:          "Polish",
//				Language:      entity.LanguageEnglish,
//				CaseSensitive: true, // This is set by isCaseSensitiveWord when POS contains "proper"
//			},
//		}, int64(1), nil)
//
//	results, _, err := uc.ListLearnedWords(ctx, query)
//	if err != nil {
//		t.Fatalf("ListLearnedWords returned error: %v", err)
//	}
//
//	if len(results) != 1 {
//		t.Fatalf("expected 1 result, got %d", len(results))
//	}
//
//	result := results[0]
//	if !result.CaseSensitive {
//		t.Error("expected CaseSensitive=true for proper noun 'Polish'")
//	}
//
//	if len(result.MatchedTerms) != 1 || result.MatchedTerms[0] != "Polish" {
//		t.Errorf("expected MatchedTerms=[Polish], got %v", result.MatchedTerms)
//	}
//}

// Test capitalization handling (Games → game)
func TestLearnedWordUsecase_ListLearnedWords_CapitalizationHandling(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// User queries "Games" (capitalized), should match stored "game" (lowercase)
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"Games"},
	}

	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"Games"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"Games": {
				{FormText: "Games", FormType: "PLURAL", LemmaText: "game", IsIrregular: false},
			},
		}, nil)

	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		Return([]entity.LearnedWord{
			{
				ID:            1,
				UserID:        userID,
				Term:          "game", // stored as lowercase
				Language:      entity.LanguageEnglish,
				CaseSensitive: false,
			},
		}, int64(1), nil)

	results, _, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	result := results[0]
	if len(result.MatchedTerms) != 1 || result.MatchedTerms[0] != "Games" {
		t.Errorf("expected MatchedTerms=[Games] (preserve original capitalization), got %v", result.MatchedTerms)
	}
}

// Test ambiguous form with multiple lemmas (does → do, doe)
func TestLearnedWordUsecase_ListLearnedWords_AmbiguousFormMultipleLemmas(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedWordUsecase(mockRepo, mockLexemeRepo)

	ctx := context.Background()
	userID := int64(1000)

	// "does" can map to both "do" and "doe" - should query both
	query := &repository.ListLearnedWordQuery{
		UserID:       userID,
		Language:     "en",
		SurfaceTerms: []string{"does"},
	}

	mockLexemeRepo.EXPECT().
		BatchLookupFormInfo(ctx, []string{"does"}, entity.LanguageEnglish).
		Return(map[string][]*repository.LexemeFormInfo{
			"does": {
				{FormText: "does", FormType: "THIRD_PERSON_SINGULAR", LemmaText: "do", IsIrregular: false},
				{FormText: "does", FormType: "PLURAL", LemmaText: "doe", IsIrregular: false}, // incorrect but handle gracefully
			},
		}, nil)

	mockRepo.EXPECT().
		List(ctx, gomock.Any()).
		DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
			// Verify that query includes both "do" and "doe"
			if !containsAll(q.SurfaceTerms, []string{"do", "doe"}) {
				t.Errorf("expected query to include both 'do' and 'doe', got %v", q.SurfaceTerms)
			}

			// User has learned "do" but not "doe"
			return []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "do",
					Language: entity.LanguageEnglish,
				},
			}, 1, nil
		})

	results, _, err := uc.ListLearnedWords(ctx, query)
	if err != nil {
		t.Fatalf("ListLearnedWords returned error: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	result := results[0]
	if result.Term != "do" {
		t.Errorf("expected Term=do, got %s", result.Term)
	}

	// Should match because "does" maps to "do" (even though it also maps to "doe")
	if len(result.MatchedTerms) != 1 || result.MatchedTerms[0] != "does" {
		t.Errorf("expected MatchedTerms=[does], got %v", result.MatchedTerms)
	}
}

// Helper functions for test assertions

// equalStringSlices checks if two string slices contain the same elements (order-independent)
func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aMap := make(map[string]bool, len(a))
	for _, s := range a {
		aMap[s] = true
	}
	for _, s := range b {
		if !aMap[s] {
			return false
		}
	}
	return true
}

// containsAll checks if slice 'haystack' contains all elements from 'needles'
func containsAll(haystack, needles []string) bool {
	haystackMap := make(map[string]bool, len(haystack))
	for _, s := range haystack {
		haystackMap[s] = true
	}
	for _, needle := range needles {
		if !haystackMap[needle] {
			return false
		}
	}
	return true
}

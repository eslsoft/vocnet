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
			if !equalStringSlices(q.SurfaceTerms, expectedTerms) {
				t.Errorf("expected SurfaceTerms to be %v, got %v", expectedTerms, q.SurfaceTerms)
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
			if !equalStringSlices(q.SurfaceTerms, expectedTerms) {
				t.Errorf("expected SurfaceTerms to be %v, got %v", expectedTerms, q.SurfaceTerms)
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
			// The order might vary, so check both are present
			if len(q.SurfaceTerms) != 2 {
				t.Errorf("expected SurfaceTerms to have 2 items, got %v", q.SurfaceTerms)
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
			if len(q.SurfaceTerms) != 1 || q.SurfaceTerms[0] != "went" {
				t.Errorf("expected SurfaceTerms to be [went], got %v", q.SurfaceTerms)
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
			// Unknown word should use itself as-is
			if len(q.SurfaceTerms) != 1 || q.SurfaceTerms[0] != "unknownword" {
				t.Errorf("expected SurfaceTerms to be [unknownword], got %v", q.SurfaceTerms)
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

	mappedTerms, _, err := uc.MapSurfaceTermsToStorageTermsWithMapping(ctx, []string{"axes"}, entity.LanguageEnglish)
	if err != nil {
		t.Fatalf("MapSurfaceTermsToStorageTermsWithMapping returned error: %v", err)
	}

	// Should include "axes" itself plus mapped lemmas "axis" and "axe"
	expectedTerms := []string{"axes", "axis", "axe"}
	if !equalStringSlices(mappedTerms, expectedTerms) {
		t.Errorf("expected mapped terms to include surface term 'axes' and lemmas, got %v", mappedTerms)
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

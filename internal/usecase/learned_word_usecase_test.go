package usecase

import (
	"context"
	"testing"

	"github.com/golang/mock/gomock"
	"github.com/google/uuid"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/mocks"
	"github.com/eslsoft/vocnet/internal/repository"
)

func TestLearnedWordUsecase_ListLearnedWords(t *testing.T) {
	t.Helper()

	type testCase struct {
		name            string
		query           repository.ListLearnedWordQuery
		lexemeResp      map[string][]*repository.LexemeFormInfo
		skipLexeme      bool
		repoResults     []entity.LearnedWord
		total           int64
		assertQuery     func(t *testing.T, q *repository.ListLearnedWordQuery)
		expectedMatches map[string][]string
	}

	userID, _ := uuid.NewUUID()
	cases := []testCase{
		{
			name: "sets queried term on lemma hit",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"learning"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"learning": {
					{
						FormText:    "learning",
						FormType:    "PRESENT_PARTICIPLE",
						LemmaText:   "learn",
						IsIrregular: false,
					},
				},
			},
			repoResults: []entity.LearnedWord{
				{
					ID:       1,
					UserID:   userID,
					Term:     "learn",
					Language: entity.LanguageEnglish,
					Mastery: entity.MasteryBreakdown{
						Overall: 300,
					},
				},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if !containsAll(q.SurfaceTerms, []string{"learning", "learn"}) {
					t.Fatalf("expected surface terms to include 'learning' and 'learn', got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"learn": {"learning"},
			},
		},
		{
			name: "handles multiple query terms",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"learning", "went", "apples"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"learning": {
					{FormText: "learning", FormType: "PRESENT_PARTICIPLE", LemmaText: "learn", IsIrregular: false},
				},
				"went": {
					{FormText: "went", FormType: "PAST_TENSE", LemmaText: "go", IsIrregular: true},
				},
				"apples": {
					{FormText: "apples", FormType: "PLURAL", LemmaText: "apple", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "learn", Language: entity.LanguageEnglish},
				{ID: 2, UserID: userID, Term: "went", Language: entity.LanguageEnglish},
				{ID: 3, UserID: userID, Term: "apple", Language: entity.LanguageEnglish},
			},
			total: 3,
			expectedMatches: map[string][]string{
				"learn": {"learning"},
				"went":  {"went"},
				"apple": {"apples"},
			},
		},
		{
			name: "skips lexeme lookup when no surface terms",
			query: repository.ListLearnedWordQuery{
				UserID:   userID,
				Language: "en",
				Keyword:  "test",
			},
			skipLexeme: true,
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "test", Language: entity.LanguageEnglish},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if len(q.SurfaceTerms) != 0 {
					t.Fatalf("expected surface terms to remain empty, got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"test": {},
			},
		},
		{
			name: "unifies surfaces mapping to same storage term",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"learning", "learned"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"learning": {
					{FormText: "learning", FormType: "PRESENT_PARTICIPLE", LemmaText: "learn", IsIrregular: false},
				},
				"learned": {
					{FormText: "learned", FormType: "PAST_TENSE", LemmaText: "learn", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "learn", Language: entity.LanguageEnglish},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if !containsAll(q.SurfaceTerms, []string{"learning", "learn", "learned"}) {
					t.Fatalf("expected mapped terms to contain learning/learn/learned, got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"learn": {"learning", "learned"},
			},
		},
		{
			name: "prefers exact lemma match but keeps inflection",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"learn", "learning"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"learn": {
					{FormText: "learn", FormType: "LEMMA", LemmaText: "learn", IsIrregular: false},
				},
				"learning": {
					{FormText: "learning", FormType: "PRESENT_PARTICIPLE", LemmaText: "learn", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "learn", Language: entity.LanguageEnglish},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if !containsAll(q.SurfaceTerms, []string{"learn", "learning"}) {
					t.Fatalf("expected query to include 'learn' and 'learning', got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"learn": {"learn", "learning"},
			},
		},
		{
			name: "ambiguous surface maps to multiple storage terms",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"learning"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"learning": {
					{FormText: "learning", FormType: "PRESENT_PARTICIPLE", LemmaText: "learn", IsIrregular: false},
					{FormText: "learning", FormType: "LEMMA", LemmaText: "learning", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "learn", Language: entity.LanguageEnglish},
				{ID: 2, UserID: userID, Term: "learning", Language: entity.LanguageEnglish},
			},
			total: 2,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if !containsAll(q.SurfaceTerms, []string{"learn", "learning"}) {
					t.Fatalf("expected ambiguous term to expand to learn and learning, got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"learn":    {"learning"},
				"learning": {"learning"},
			},
		},
		{
			name: "keeps irregular forms unchanged",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"went"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"went": {
					{FormText: "went", FormType: "PAST_TENSE", LemmaText: "go", IsIrregular: true},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "went", Language: entity.LanguageEnglish},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if !containsAll(q.SurfaceTerms, []string{"went"}) {
					t.Fatalf("expected irregular term 'went' to stay unchanged, got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"went": {"went"},
			},
		},
		{
			name: "falls back to original term when lexeme lookup fails",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"unknownword"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "unknownword", Language: entity.LanguageEnglish},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if !containsAll(q.SurfaceTerms, []string{"unknownword"}) {
					t.Fatalf("expected unknown term to stay as-is, got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"unknownword": {"unknownword"},
			},
		},
		{
			name: "aggregates matched terms across overlapping queries",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"apple", "apples"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"apple": {
					{FormText: "apple", FormType: "LEMMA", LemmaText: "apple", IsIrregular: false},
				},
				"apples": {
					{FormText: "apples", FormType: "PLURAL", LemmaText: "apple", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "apple", Language: entity.LanguageEnglish},
			},
			total: 1,
			expectedMatches: map[string][]string{
				"apple": {"apple", "apples"},
			},
		},
		{
			name: "regression coverage for matched terms",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"governing", "hired", "Games", "sales", "searching", "does", "goes", "Roots"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"governing": {{FormText: "governing", FormType: "PRESENT_PARTICIPLE", LemmaText: "govern", IsIrregular: false}},
				"hired":     {{FormText: "hired", FormType: "PAST_TENSE", LemmaText: "hire", IsIrregular: false}},
				"Games":     {{FormText: "Games", FormType: "PLURAL", LemmaText: "game", IsIrregular: false}},
				"sales":     {{FormText: "sales", FormType: "PLURAL", LemmaText: "sale", IsIrregular: false}},
				"searching": {{FormText: "searching", FormType: "PRESENT_PARTICIPLE", LemmaText: "search", IsIrregular: false}},
				"does": {
					{FormText: "does", FormType: "THIRD_PERSON_SINGULAR", LemmaText: "do", IsIrregular: false},
					{FormText: "does", FormType: "PLURAL", LemmaText: "doe", IsIrregular: false},
				},
				"goes": {
					{FormText: "goes", FormType: "THIRD_PERSON_SINGULAR", LemmaText: "go", IsIrregular: false},
					{FormText: "goes", FormType: "PLURAL", LemmaText: "goe", IsIrregular: false},
				},
				"Roots": {
					{FormText: "Roots", FormType: "LEMMA", LemmaText: "roots", IsIrregular: false},
					{FormText: "Roots", FormType: "PLURAL", LemmaText: "root", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "govern", Language: entity.LanguageEnglish},
				{ID: 2, UserID: userID, Term: "hire", Language: entity.LanguageEnglish},
				{ID: 3, UserID: userID, Term: "game", Language: entity.LanguageEnglish},
				{ID: 4, UserID: userID, Term: "sale", Language: entity.LanguageEnglish},
				{ID: 5, UserID: userID, Term: "search", Language: entity.LanguageEnglish},
				{ID: 6, UserID: userID, Term: "do", Language: entity.LanguageEnglish},
				{ID: 7, UserID: userID, Term: "go", Language: entity.LanguageEnglish},
				{ID: 8, UserID: userID, Term: "root", Language: entity.LanguageEnglish},
			},
			total: 8,
			expectedMatches: map[string][]string{
				"govern": {"governing"},
				"hire":   {"hired"},
				"game":   {"Games"},
				"sale":   {"sales"},
				"search": {"searching"},
				"do":     {"does"},
				"go":     {"goes"},
				"root":   {"Roots"},
			},
		},
		{
			name: "preserves queried capitalization in matched terms",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"Games"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"Games": {
					{FormText: "Games", FormType: "PLURAL", LemmaText: "game", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "game", Language: entity.LanguageEnglish},
			},
			total: 1,
			expectedMatches: map[string][]string{
				"game": {"Games"},
			},
		},
		{
			name: "queries every lemma candidate for ambiguous forms",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"does"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"does": {
					{FormText: "does", FormType: "THIRD_PERSON_SINGULAR", LemmaText: "do", IsIrregular: false},
					{FormText: "does", FormType: "PLURAL", LemmaText: "doe", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "do", Language: entity.LanguageEnglish},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if !containsAll(q.SurfaceTerms, []string{"do", "doe"}) {
					t.Fatalf("expected query with lemma candidates 'do' and 'doe', got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"do": {"does"},
			},
		},
		{
			name: "case-sensitive word matches only with correct case",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"Sunday"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"Sunday": {
					{FormText: "Sunday", FormType: "LEMMA", LemmaText: "Sunday", IsIrregular: false, Pos: "proper noun"},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "Sunday", Language: entity.LanguageEnglish, CaseSensitive: true},
			},
			total: 1,
			expectedMatches: map[string][]string{
				"Sunday": {"Sunday"},
			},
		},
		{
			name: "case-sensitive word does not match with wrong case",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"sunday"}, // lowercase query
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"sunday": {},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "Sunday", Language: entity.LanguageEnglish, CaseSensitive: true},
			},
			total: 1,
			expectedMatches: map[string][]string{
				"Sunday": {}, // Should not match "sunday" query
			},
		},
		{
			name: "case-insensitive word matches regardless of case",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"APPLE"}, // uppercase query
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"APPLE": {
					{FormText: "APPLE", FormType: "LEMMA", LemmaText: "apple", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "apple", Language: entity.LanguageEnglish, CaseSensitive: false},
			},
			total: 1,
			expectedMatches: map[string][]string{
				"apple": {"APPLE"}, // Should match despite different case
			},
		},
		{
			name: "distinguishes between Polish and polish",
			query: repository.ListLearnedWordQuery{
				UserID:       userID,
				Language:     "en",
				SurfaceTerms: []string{"Polish", "polish"},
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"Polish": {
					{FormText: "Polish", FormType: "LEMMA", LemmaText: "Polish", IsIrregular: false, Pos: "proper noun"},
				},
				"polish": {
					{FormText: "polish", FormType: "LEMMA", LemmaText: "polish", IsIrregular: false, Pos: "verb"},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "Polish", Language: entity.LanguageEnglish, CaseSensitive: true},
				{ID: 2, UserID: userID, Term: "polish", Language: entity.LanguageEnglish, CaseSensitive: false},
			},
			total: 2,
			expectedMatches: map[string][]string{
				"Polish": {"Polish"},           // case-sensitive matches only "Polish"
				"polish": {"Polish", "polish"}, // case-insensitive matches both variants
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			repo := mocks.NewMockLearnedWordRepository(ctrl)
			lexemeRepo := mocks.NewMockLexemeRepository(ctrl)
			uc := NewLearnedWordUsecase(repo, lexemeRepo)

			ctx := context.Background()
			query := tc.query
			if !tc.skipLexeme && len(query.SurfaceTerms) > 0 {
				lexemeRepo.EXPECT().
					BatchLookupFormInfo(ctx, query.SurfaceTerms, expectedLexemeLanguage(query.Language)).
					Return(tc.lexemeResp, nil)
			}

			repo.EXPECT().
				List(ctx, gomock.Any()).
				DoAndReturn(func(_ context.Context, q *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
					if tc.assertQuery != nil {
						tc.assertQuery(t, q)
					}
					return cloneLearnedWords(tc.repoResults), tc.total, nil
				})

			results, total, err := uc.ListLearnedWords(ctx, &query)
			if err != nil {
				t.Fatalf("ListLearnedWords returned error: %v", err)
			}

			if total != tc.total {
				t.Fatalf("expected total %d, got %d", tc.total, total)
			}

			assertMatchedTerms(t, results, tc.expectedMatches)
		})
	}
}

func TestLearnedWordUsecase_MapSurfaceTermsToStorageTermsWithMapping(t *testing.T) {
	t.Helper()

	type testCase struct {
		name            string
		surfaceTerms    []string
		lexemeResp      map[string][]*repository.LexemeFormInfo
		expectedTerms   []string
		expectedMapping map[string][]string
	}

	cases := []testCase{
		{
			name:         "includes surface term alongside lemma candidates",
			surfaceTerms: []string{"axes"},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"axes": {
					{FormText: "axes", FormType: "PLURAL", LemmaText: "axis", IsIrregular: false},
					{FormText: "axes", FormType: "PLURAL", LemmaText: "axe", IsIrregular: false},
				},
			},
			expectedTerms: []string{"axes", "axis", "axe"},
			expectedMapping: map[string][]string{
				"axes": {"axes", "axis", "axe"},
			},
		},
		{
			name:         "skips self referencing lemma entries",
			surfaceTerms: []string{"Roots"},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"Roots": {
					{FormText: "Roots", FormType: "LEMMA", LemmaText: "roots", IsIrregular: false},
					{FormText: "Roots", FormType: "PLURAL", LemmaText: "root", IsIrregular: false},
				},
			},
			expectedTerms: []string{"Roots", "root"},
			expectedMapping: map[string][]string{
				"Roots": {"Roots", "root"},
			},
		},
		{
			name:         "irregular form stays as-is",
			surfaceTerms: []string{"went"},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"went": {
					{FormText: "went", FormType: "PAST_TENSE", LemmaText: "go", IsIrregular: true},
				},
			},
			expectedTerms: []string{"went"},
			expectedMapping: map[string][]string{
				"went": {"went"},
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			repo := mocks.NewMockLearnedWordRepository(ctrl)
			lexemeRepo := mocks.NewMockLexemeRepository(ctrl)
			uc := NewLearnedWordUsecase(repo, lexemeRepo).(*learnedWordUsecase)

			ctx := context.Background()
			lexemeRepo.EXPECT().
				BatchLookupFormInfo(ctx, tc.surfaceTerms, entity.LanguageEnglish).
				Return(tc.lexemeResp, nil)

			terms, mapping, err := uc.MapSurfaceTermsToStorageTerms(ctx, tc.surfaceTerms, entity.LanguageEnglish)
			if err != nil {
				t.Fatalf("MapSurfaceTermsToStorageTermsWithMapping returned error: %v", err)
			}

			if !equalStringSlices(terms, tc.expectedTerms) {
				t.Fatalf("expected terms %v, got %v", tc.expectedTerms, terms)
			}

			for surface, expected := range tc.expectedMapping {
				if !equalStringSlices(mapping[surface], expected) {
					t.Fatalf("surface %s: expected mapping %v, got %v", surface, expected, mapping[surface])
				}
			}
		})
	}
}

func assertMatchedTerms(t *testing.T, results []entity.LearnedWord, expected map[string][]string) {
	t.Helper()

	if len(results) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(results))
	}

	seen := make(map[string]struct{}, len(results))
	for _, result := range results {
		expectedMatches, ok := expected[result.Term]
		if !ok {
			t.Errorf("unexpected result term: %s", result.Term)
			continue
		}
		seen[result.Term] = struct{}{}

		if !equalStringSlices(result.MatchedTerms, expectedMatches) {
			t.Errorf("term=%s: expected MatchedTerms=%v, got %v", result.Term, expectedMatches, result.MatchedTerms)
		}
	}

	for term := range expected {
		if _, ok := seen[term]; !ok {
			t.Errorf("expected term %s to be returned, but it was missing", term)
		}
	}
}

func cloneLearnedWords(words []entity.LearnedWord) []entity.LearnedWord {
	if len(words) == 0 {
		return nil
	}
	cloned := make([]entity.LearnedWord, len(words))
	copy(cloned, words)
	return cloned
}

func expectedLexemeLanguage(language string) entity.Language {
	lang := entity.ParseLanguage(language)
	lang = entity.NormalizeLanguage(lang)
	if lang == entity.LanguageUnspecified {
		return entity.LanguageEnglish
	}
	return lang
}

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

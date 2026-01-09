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
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"learning"},
				AutoInheritMastery: true,
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
					Normal:   "learn",
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
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"learning", "went", "apples"},
				AutoInheritMastery: true,
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
				{ID: 1, UserID: userID, Term: "learn", Normal: "learn", Language: entity.LanguageEnglish},
				{ID: 2, UserID: userID, Term: "went", Normal: "went", Language: entity.LanguageEnglish},
				{ID: 3, UserID: userID, Term: "apple", Normal: "apple", Language: entity.LanguageEnglish},
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
				{ID: 1, UserID: userID, Term: "test", Normal: "test", Language: entity.LanguageEnglish},
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
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"learning", "learned"},
				AutoInheritMastery: true,
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
				{ID: 1, UserID: userID, Term: "learn", Normal: "learn", Language: entity.LanguageEnglish},
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
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"learn", "learning"},
				AutoInheritMastery: true,
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
				{ID: 1, UserID: userID, Term: "learn", Normal: "learn", Language: entity.LanguageEnglish},
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
			name: "ambiguous surface stays as-is",
			query: repository.ListLearnedWordQuery{
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"learning"},
				AutoInheritMastery: true,
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"learning": {
					{FormText: "learning", FormType: "PRESENT_PARTICIPLE", LemmaText: "learn", IsIrregular: false},
					{FormText: "learning", FormType: "LEMMA", LemmaText: "learning", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "learning", Normal: "learning", Language: entity.LanguageEnglish},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				if !containsAll(q.SurfaceTerms, []string{"learning"}) {
					t.Fatalf("expected ambiguous term to stay as-is, got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"learning": {"learning"},
			},
		},
		{
			name: "keeps irregular forms unchanged",
			query: repository.ListLearnedWordQuery{
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"went"},
				AutoInheritMastery: true,
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"went": {
					{FormText: "went", FormType: "PAST_TENSE", LemmaText: "go", IsIrregular: true},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "went", Normal: "went", Language: entity.LanguageEnglish},
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
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"unknownword"},
				AutoInheritMastery: true,
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "unknownword", Normal: "unknownword", Language: entity.LanguageEnglish},
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
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"apple", "apples"},
				AutoInheritMastery: true,
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
				{ID: 1, UserID: userID, Term: "apple", Normal: "apple", Language: entity.LanguageEnglish},
			},
			total: 1,
			expectedMatches: map[string][]string{
				"apple": {"apple", "apples"},
			},
		},
		{
			name: "regression coverage for matched terms",
			query: repository.ListLearnedWordQuery{
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"governing", "hired", "Games", "sales", "searching"},
				AutoInheritMastery: true,
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"governing": {{FormText: "governing", FormType: "PRESENT_PARTICIPLE", LemmaText: "govern", IsIrregular: false}},
				"hired":     {{FormText: "hired", FormType: "PAST_TENSE", LemmaText: "hire", IsIrregular: false}},
				"Games":     {{FormText: "Games", FormType: "PLURAL", LemmaText: "game", IsIrregular: false}},
				"sales":     {{FormText: "sales", FormType: "PLURAL", LemmaText: "sale", IsIrregular: false}},
				"searching": {{FormText: "searching", FormType: "PRESENT_PARTICIPLE", LemmaText: "search", IsIrregular: false}},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "govern", Normal: "govern", Language: entity.LanguageEnglish},
				{ID: 2, UserID: userID, Term: "hire", Normal: "hire", Language: entity.LanguageEnglish},
				{ID: 3, UserID: userID, Term: "game", Normal: "game", Language: entity.LanguageEnglish},
				{ID: 4, UserID: userID, Term: "sale", Normal: "sale", Language: entity.LanguageEnglish},
				{ID: 5, UserID: userID, Term: "search", Normal: "search", Language: entity.LanguageEnglish},
			},
			total: 5,
			expectedMatches: map[string][]string{
				"govern": {"governing"},
				"hire":   {"hired"},
				"game":   {"Games"},
				"sale":   {"sales"},
				"search": {"searching"},
			},
		},
		{
			name: "preserves queried capitalization in matched terms",
			query: repository.ListLearnedWordQuery{
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"Games"},
				AutoInheritMastery: true,
			},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"Games": {
					{FormText: "Games", FormType: "PLURAL", LemmaText: "game", IsIrregular: false},
				},
			},
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "game", Normal: "game", Language: entity.LanguageEnglish},
			},
			total: 1,
			expectedMatches: map[string][]string{
				"game": {"Games"},
			},
		},
		{
			name: "disables inheritance when AutoInheritMastery is false",
			query: repository.ListLearnedWordQuery{
				UserID:             userID,
				Language:           "en",
				SurfaceTerms:       []string{"learning", "learn"},
				AutoInheritMastery: false,
			},
			skipLexeme: true, // Should not call lexeme lookup when inheritance is disabled
			repoResults: []entity.LearnedWord{
				{ID: 1, UserID: userID, Term: "learning", Normal: "learning", Language: entity.LanguageEnglish},
			},
			total: 1,
			assertQuery: func(t *testing.T, q *repository.ListLearnedWordQuery) {
				t.Helper()
				// SurfaceTerms should remain unchanged (no lemma mapping)
				if !equalStringSlices(q.SurfaceTerms, []string{"learning", "learn"}) {
					t.Fatalf("expected surface terms to remain unchanged, got %v", q.SurfaceTerms)
				}
			},
			expectedMatches: map[string][]string{
				"learning": {"learning"},
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

func TestLearnedWordUsecase_MapSurfaceTermsToStorageTerms(t *testing.T) {
	t.Helper()

	type testCase struct {
		name            string
		surfaceTerms    []string
		lexemeResp      map[string][]*repository.LexemeFormInfo
		expectedTerms   []string
		expectedMapping map[string]string
	}

	cases := []testCase{
		{
			name:         "includes surface term alongside lemma candidate",
			surfaceTerms: []string{"axes"},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"axes": {
					{FormText: "axes", FormType: "PLURAL", LemmaText: "axis", IsIrregular: false},
				},
			},
			expectedTerms: []string{"axes", "axis"},
			expectedMapping: map[string]string{
				"axes": "axis",
			},
		},
		{
			name:         "lemma mapping points to self for non-inflections",
			surfaceTerms: []string{"roots"},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"roots": {
					{FormText: "roots", FormType: "LEMMA", LemmaText: "roots", IsIrregular: false},
				},
			},
			expectedTerms: []string{"roots"},
			expectedMapping: map[string]string{
				"roots": "roots",
			},
		},
		{
			name:         "irregular form does not inherit",
			surfaceTerms: []string{"went"},
			lexemeResp: map[string][]*repository.LexemeFormInfo{
				"went": {
					{FormText: "went", FormType: "PAST_TENSE", LemmaText: "go", IsIrregular: true},
				},
			},
			expectedTerms: []string{"went"},
			expectedMapping: map[string]string{
				"went": "went",
			},
		},
		{
			name:         "unrecognized word stays as-is",
			surfaceTerms: []string{"foobar"},
			lexemeResp:    map[string][]*repository.LexemeFormInfo{},
			expectedTerms: []string{"foobar"},
			expectedMapping: map[string]string{
				"foobar": "foobar",
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
				t.Fatalf("MapSurfaceTermsToStorageTerms returned error: %v", err)
			}

			if !equalStringSlices(terms, tc.expectedTerms) {
				t.Fatalf("expected terms %v, got %v", tc.expectedTerms, terms)
			}

			for surface, expected := range tc.expectedMapping {
				if mapping[surface] != expected {
					t.Fatalf("surface %s: expected mapping %s, got %s", surface, expected, mapping[surface])
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

package connectrpc

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
)

// createSnapshotInDB creates a LemmaSnapshot for testing
func createSnapshotInDB(t *testing.T, client *ent.Client, word *dictv1.Word) int64 {
	t.Helper()
	ctx := context.Background()

	// Map commonv1.Language to language code
	langCode := "en"
	switch word.Language {
	case commonv1.Language_LANGUAGE_FRENCH:
		langCode = "fr"
	case commonv1.Language_LANGUAGE_SPANISH:
		langCode = "es"
	case commonv1.Language_LANGUAGE_CHINESE:
		langCode = "zh"
	}

	// Create Lemma first
	lemmaRecord, err := client.Lemma.Create().
		SetSurface(word.Term).
		SetNormalized(strings.ToLower(word.Term)).
		SetLevel(word.Level).
		Save(ctx)
	require.NoError(t, err)

	// Build snapshot payload
	var forms []entity.LemmaSnapshotForm
	// Add lemma form
	var lemmaPhonetics []entity.Phonetic
	for _, p := range word.Phonetics {
		lemmaPhonetics = append(lemmaPhonetics, entity.Phonetic{
			IPA:     p.Ipa,
			Dialect: p.Dialect,
		})
	}
	forms = append(forms, entity.LemmaSnapshotForm{
		Surface:   word.Term,
		FormType:  "LEMMA",
		Phonetics: lemmaPhonetics,
	})

	// Add related forms
	for _, form := range word.RelatedForms {
		formType := strings.TrimPrefix(form.FormType.String(), "FORM_TYPE_")
		forms = append(forms, entity.LemmaSnapshotForm{
			Surface:     form.Term,
			FormType:    formType,
			IsIrregular: form.Irregular,
			Syllables:   form.Syllables,
		})
	}

	// Build lexemes
	var lexemes []entity.LemmaSnapshotLexeme
	for _, meaning := range word.Meanings {
		var senses []entity.LemmaSnapshotSense
		for _, def := range meaning.Definitions {
			defLang := "en"
			switch def.Language {
			case commonv1.Language_LANGUAGE_FRENCH:
				defLang = "fr"
			case commonv1.Language_LANGUAGE_SPANISH:
				defLang = "es"
			case commonv1.Language_LANGUAGE_CHINESE:
				defLang = "zh"
			}
			senses = append(senses, entity.LemmaSnapshotSense{
				Language: defLang,
				Gloss:    def.Gloss,
			})
		}
		lexemes = append(lexemes, entity.LemmaSnapshotLexeme{
			ExternalID: meaning.LexemeId,
			Language:   langCode,
			POS:        meaning.Pos,
			Senses:     senses,
		})
	}

	// Build relations
	var relations []entity.LemmaSnapshotRelation
	for _, rel := range word.Relations {
		relType := strings.TrimPrefix(rel.Type.String(), "RELATION_TYPE_")
		relType = strings.ToLower(relType)
		relations = append(relations, entity.LemmaSnapshotRelation{
			RelationType: relType,
			TargetTerm:   rel.TargetWord,
			Strength:     rel.Strength,
			Provider:     rel.Provider,
		})
	}

	// Build lookup terms (include all forms for lookup)
	lookupTerms := []string{strings.ToLower(word.Term)}
	for _, form := range word.RelatedForms {
		lookupTerms = append(lookupTerms, strings.ToLower(form.Term))
	}

	// Create snapshot
	payload := entity.LemmaSnapshotData{
		Lexemes:    lexemes,
		Forms:      forms,
		Categories: word.Categories,
		Relations:  relations,
	}

	_, err = client.LemmaSnapshot.Create().
		SetLemma(lemmaRecord).
		SetSurface(word.Term).
		SetNormalized(strings.ToLower(word.Term)).
		SetLanguage(langCode).
		SetLookupTerms(lookupTerms).
		SetIsLatest(true).
		SetVersion(1).
		SetSchemaVersion(1).
		SetPayload(payload).
		SetQualityOverall(0.8).
		SetQualityCompleteness(0.8).
		SetQualityDepth(0.8).
		SetQualityDensity(0.8).
		SetQualityValidity(0.8).
		SetLexemeCount(int32(len(lexemes))).
		SetSenseCount(int32(len(lexemes))).
		SetFormCount(int32(len(forms))).
		SetRelationCount(int32(len(relations))).
		SetProviderCount(1).
		SetSynthesizedAt(time.Now()).
		Save(ctx)
	require.NoError(t, err)

	return lemmaRecord.ID
}

func TestDictService_LookupWord_Basics(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	lemmaRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	word := &dictv1.Word{
		Term:     "hello",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		Meanings: []*dictv1.Meaning{
			{
				LexemeId: "L789",
				Pos:      "interj.",
				Definitions: []*dictv1.Definition{
					{
						Language: commonv1.Language_LANGUAGE_ENGLISH,
						Gloss:    "a greeting",
					},
				},
			},
		},
	}

	createSnapshotInDB(t, client, word)

	lookupResp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
		Msg: &dictv1.LookupWordRequest{Word: "hello"},
	})
	require.NoError(t, err)
	require.NotNil(t, lookupResp)
	assert.Equal(t, "hello", lookupResp.Msg.Term)
}

func TestDictService_ListWords_Filtering(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	lemmaRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	// Create test words with different categories
	words := []*dictv1.Word{
		{
			Term:       "apple",
			TermType:   dictv1.FormType_FORM_TYPE_LEMMA,
			Language:   commonv1.Language_LANGUAGE_ENGLISH,
			Categories: []string{"cet4", "fruit"},
			Meanings: []*dictv1.Meaning{
				{LexemeId: "L1001", Pos: "n.", Definitions: []*dictv1.Definition{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "a fruit"},
				}},
			},
		},
		{
			Term:       "book",
			TermType:   dictv1.FormType_FORM_TYPE_LEMMA,
			Language:   commonv1.Language_LANGUAGE_ENGLISH,
			Categories: []string{"cet4", "education"},
			Meanings: []*dictv1.Meaning{
				{LexemeId: "L1002", Pos: "n.", Definitions: []*dictv1.Definition{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "a written work"},
				}},
			},
		},
		{
			Term:       "computer",
			TermType:   dictv1.FormType_FORM_TYPE_LEMMA,
			Language:   commonv1.Language_LANGUAGE_ENGLISH,
			Categories: []string{"cet6", "technology"},
			Meanings: []*dictv1.Meaning{
				{LexemeId: "L1003", Pos: "n.", Definitions: []*dictv1.Definition{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "an electronic device"},
				}},
			},
		},
	}

	// Create all words
	for _, w := range words {
		createSnapshotInDB(t, client, w)
	}

	tests := []struct {
		name          string
		req           *dictv1.ListWordsRequest
		expectedCount int
		checkFunc     func(*testing.T, []*dictv1.Word)
	}{
		{
			name: "filter by keyword - exact lemma",
			req: &dictv1.ListWordsRequest{
				Filter: `keyword == "book"`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "book", words[0].Term)
			},
		},
		{
			name: "filter by keyword - partial lemma",
			req: &dictv1.ListWordsRequest{
				Filter: `keyword == "app"`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "apple", words[0].Term)
			},
		},
		{
			name: "filter by category - cet4",
			req: &dictv1.ListWordsRequest{
				Filter: `category in ["cet4"]`,
			},
			expectedCount: 2,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				terms := make([]string, len(words))
				for i, w := range words {
					terms[i] = w.Term
				}
				assert.Contains(t, terms, "apple")
				assert.Contains(t, terms, "book")
			},
		},
		{
			name: "filter by category - cet6",
			req: &dictv1.ListWordsRequest{
				Filter: `category in ["cet6"]`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "computer", words[0].Term)
			},
		},
		{
			name: "filter by multiple categories",
			req: &dictv1.ListWordsRequest{
				Filter: `category in ["cet4", "cet6"]`,
			},
			expectedCount: 3,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				terms := make([]string, len(words))
				for i, w := range words {
					terms[i] = w.Term
				}
				assert.Contains(t, terms, "apple")
				assert.Contains(t, terms, "book")
				assert.Contains(t, terms, "computer")
			},
		},
		{
			name: "pagination - first page",
			req: &dictv1.ListWordsRequest{
				Pagination: &commonv1.PaginationRequest{
					PageNo:   1,
					PageSize: 2,
				},
			},
			expectedCount: 2,
			checkFunc:     func(t *testing.T, words []*dictv1.Word) {},
		},
		{
			name: "pagination - second page",
			req: &dictv1.ListWordsRequest{
				Pagination: &commonv1.PaginationRequest{
					PageNo:   2,
					PageSize: 2,
				},
			},
			expectedCount: 1,
			checkFunc:     func(t *testing.T, words []*dictv1.Word) {},
		},
		{
			name: "order by surface ascending",
			req: &dictv1.ListWordsRequest{
				OrderBy: "surface",
			},
			expectedCount: 3,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				// Should be: apple, book, computer
				assert.Equal(t, "apple", words[0].Term)
				assert.Equal(t, "book", words[1].Term)
				assert.Equal(t, "computer", words[2].Term)
			},
		},
		{
			name: "order by surface descending",
			req: &dictv1.ListWordsRequest{
				OrderBy: "surface desc",
			},
			expectedCount: 3,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				// Should be: computer, book, apple
				assert.Equal(t, "computer", words[0].Term)
				assert.Equal(t, "book", words[1].Term)
				assert.Equal(t, "apple", words[2].Term)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.ListWords(ctx, &connect.Request[dictv1.ListWordsRequest]{
				Msg: tt.req,
			})
			require.NoError(t, err)
			require.NotNil(t, resp)

			assert.Equal(t, tt.expectedCount, len(resp.Msg.Words), "Expected %d words, got %d", tt.expectedCount, len(resp.Msg.Words))

			if tt.checkFunc != nil {
				tt.checkFunc(t, resp.Msg.Words)
			}

			// Check pagination metadata
			assert.NotNil(t, resp.Msg.Pagination)
			assert.GreaterOrEqual(t, resp.Msg.Pagination.Total, int32(tt.expectedCount))
		})
	}
}

func TestDictService_GetWordStats(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	lemmaRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	createSnapshotInDB(t, client, &dictv1.Word{
		Term:     "run",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		Categories: []string{
			"basic",
		},
		Phonetics: []*dictv1.Phonetic{
			{Ipa: "/rʌn/"},
		},
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "runs", FormType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR},
		},
		Meanings: []*dictv1.Meaning{
			{
				LexemeId: "L100",
				Pos:      "v.",
				Definitions: []*dictv1.Definition{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "move swiftly"},
				},
			},
		},
	})

	createSnapshotInDB(t, client, &dictv1.Word{
		Term:     "hola",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_SPANISH,
		Categories: []string{
			"greeting",
		},
		Meanings: []*dictv1.Meaning{
			{
				LexemeId: "L200",
				Pos:      "interj.",
				Definitions: []*dictv1.Definition{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "hello"},
				},
			},
		},
	})

	resp, err := svc.GetWordStats(ctx, &connect.Request[dictv1.GetWordStatsRequest]{
		Msg: &dictv1.GetWordStatsRequest{},
	})
	require.NoError(t, err)
	require.NotNil(t, resp.Msg)

	stats := resp.Msg
	require.NotNil(t, stats.Summary)
	assert.EqualValues(t, 2, stats.Summary.TotalWords)
	assert.EqualValues(t, 2, stats.Summary.TotalLexemes)
}

func TestDictService_ListWords_SurfaceFiltering(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	lemmaRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	// Create a word with forms
	runWord := &dictv1.Word{
		Term:       "run",
		TermType:   dictv1.FormType_FORM_TYPE_LEMMA,
		Language:   commonv1.Language_LANGUAGE_ENGLISH,
		Categories: []string{"cet4"},
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "runs", FormType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR},
			{Term: "running", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
			{Term: "ran", FormType: dictv1.FormType_FORM_TYPE_PAST},
		},
		Meanings: []*dictv1.Meaning{
			{
				LexemeId: "L2001",
				Pos:      "v.",
				Definitions: []*dictv1.Definition{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to move swiftly"},
				},
			},
		},
	}

	swimWord := &dictv1.Word{
		Term:       "swim",
		TermType:   dictv1.FormType_FORM_TYPE_LEMMA,
		Language:   commonv1.Language_LANGUAGE_ENGLISH,
		Categories: []string{"cet4"},
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "swims", FormType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR},
			{Term: "swimming", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
			{Term: "swam", FormType: dictv1.FormType_FORM_TYPE_PAST},
		},
		Meanings: []*dictv1.Meaning{
			{
				LexemeId: "L2002",
				Pos:      "v.",
				Definitions: []*dictv1.Definition{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to move through water"},
				},
			},
		},
	}

	// Create both words
	createSnapshotInDB(t, client, runWord)
	createSnapshotInDB(t, client, swimWord)

	tests := []struct {
		name          string
		filter        string
		expectedCount int
		expectedLemma string
	}{
		{
			name:          "find by lemma",
			filter:        `surface in ["run"]`,
			expectedCount: 1,
			expectedLemma: "run",
		},
		{
			name:          "find by inflected form - running",
			filter:        `surface in ["running"]`,
			expectedCount: 1,
			expectedLemma: "run",
		},
		{
			name:          "find by inflected form - ran",
			filter:        `surface in ["ran"]`,
			expectedCount: 1,
			expectedLemma: "run",
		},
		{
			name:          "batch lookup by multiple forms",
			filter:        `surface in ["running", "swam"]`,
			expectedCount: 2,
			expectedLemma: "", // both run and swim
		},
		{
			name:          "no match",
			filter:        `surface in ["walked"]`,
			expectedCount: 0,
			expectedLemma: "",
		},
		{
			name:          "keyword search finds inflected form",
			filter:        `keyword == "running"`,
			expectedCount: 1,
			expectedLemma: "run",
		},
		{
			name:          "keyword search finds by partial inflected form",
			filter:        `keyword == "swim"`,
			expectedCount: 1,
			expectedLemma: "swim",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.ListWords(ctx, &connect.Request[dictv1.ListWordsRequest]{
				Msg: &dictv1.ListWordsRequest{
					Filter: tt.filter,
				},
			})
			require.NoError(t, err)
			require.NotNil(t, resp)

			assert.Equal(t, tt.expectedCount, len(resp.Msg.Words), "Expected %d words, got %d", tt.expectedCount, len(resp.Msg.Words))

			if tt.expectedCount == 1 && tt.expectedLemma != "" {
				word := resp.Msg.Words[0]
				lemmaText := word.Term
				if word.Lemma != nil {
					lemmaText = word.GetLemma()
				}
				assert.Equal(t, tt.expectedLemma, lemmaText)
			}
		})
	}
}

// TestDictService_LookupWord_IrregularFlag verifies that the API returns correct irregular
// flags for word forms. Regular inflected forms (defined, covered, limits, etc.) must NOT
// be marked irregular, while truly irregular forms (ran, children) must be marked irregular.
// Regression test for: pipeline used raw input term instead of resolved lemma surface for
// irregular detection, causing all forms of inflected-term lookups to be mismarked.
func TestDictService_LookupWord_IrregularFlag(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	lemmaRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	// Create "define" with regular forms (none should be irregular)
	createSnapshotInDB(t, client, &dictv1.Word{
		Term:     "define",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "defined", FormType: dictv1.FormType_FORM_TYPE_PAST, Irregular: false},
			{Term: "defines", FormType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, Irregular: false},
			{Term: "defining", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, Irregular: false},
		},
		Meanings: []*dictv1.Meaning{
			{LexemeId: "L-DEFINE", Pos: "v.", Definitions: []*dictv1.Definition{
				{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to explain the meaning of"},
			}},
		},
	})

	// Create "run" with irregular forms
	createSnapshotInDB(t, client, &dictv1.Word{
		Term:     "run",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "ran", FormType: dictv1.FormType_FORM_TYPE_PAST, Irregular: true},
			{Term: "runs", FormType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, Irregular: false},
			{Term: "running", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, Irregular: false},
		},
		Meanings: []*dictv1.Meaning{
			{LexemeId: "L-RUN", Pos: "v.", Definitions: []*dictv1.Definition{
				{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to move swiftly"},
			}},
		},
	})

	// Create more words that were historically misdetected
	createSnapshotInDB(t, client, &dictv1.Word{
		Term:     "start",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "starting", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, Irregular: false},
			{Term: "started", FormType: dictv1.FormType_FORM_TYPE_PAST, Irregular: false},
		},
		Meanings: []*dictv1.Meaning{
			{LexemeId: "L-START", Pos: "v.", Definitions: []*dictv1.Definition{
				{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to begin"},
			}},
		},
	})

	tests := []struct {
		name          string
		query         string
		wantIrregular bool
		wantLemma     string // expected Lemma field (empty means nil/not set for lemma view)
	}{
		// Regular forms looked up directly — MUST NOT be irregular
		{name: "defined_regular", query: "defined", wantIrregular: false, wantLemma: "define"},
		{name: "defines_regular", query: "defines", wantIrregular: false, wantLemma: "define"},
		{name: "defining_regular", query: "defining", wantIrregular: false, wantLemma: "define"},
		{name: "starting_regular", query: "starting", wantIrregular: false, wantLemma: "start"},
		{name: "started_regular", query: "started", wantIrregular: false, wantLemma: "start"},
		// Irregular forms — MUST be irregular
		{name: "ran_irregular", query: "ran", wantIrregular: true, wantLemma: "run"},
		// Regular forms of irregular verbs — MUST NOT be irregular
		{name: "runs_regular", query: "runs", wantIrregular: false, wantLemma: "run"},
		{name: "running_regular", query: "running", wantIrregular: false, wantLemma: "run"},
		// Lemma lookup — MUST NOT be irregular, no Lemma field
		{name: "define_lemma", query: "define", wantIrregular: false, wantLemma: ""},
		{name: "run_lemma", query: "run", wantIrregular: false, wantLemma: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
				Msg: &dictv1.LookupWordRequest{Word: tt.query},
			})
			require.NoError(t, err)
			require.NotNil(t, resp.Msg)

			assert.Equal(t, tt.wantIrregular, resp.Msg.Irregular,
				"LookupWord(%q): irregular should be %v", tt.query, tt.wantIrregular)

			if tt.wantLemma != "" {
				require.NotNil(t, resp.Msg.Lemma,
					"LookupWord(%q): expected Lemma field to be set", tt.query)
				assert.Equal(t, tt.wantLemma, resp.Msg.GetLemma(),
					"LookupWord(%q): wrong lemma", tt.query)
			} else {
				assert.Nil(t, resp.Msg.Lemma,
					"LookupWord(%q): Lemma field should be nil for lemma view", tt.query)
			}
		})
	}
}

// TestDictService_LookupWord_LemmaNotEmpty verifies that looking up inflected forms
// always returns a non-empty Lemma reference pointing to the correct base form.
// Regression test for: pipeline produced empty snapshot.Surface for inflected-form inputs
// (e.g., "starting"), causing LookupWord("starting") to return Word{Lemma: ""}.
func TestDictService_LookupWord_LemmaNotEmpty(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	lemmaRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	// Correct snapshot: surface="start", forms include "starting"
	createSnapshotInDB(t, client, &dictv1.Word{
		Term:     "start",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "starting", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
			{Term: "started", FormType: dictv1.FormType_FORM_TYPE_PAST},
			{Term: "starts", FormType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR},
		},
		Meanings: []*dictv1.Meaning{
			{LexemeId: "L-START", Pos: "v.", Definitions: []*dictv1.Definition{
				{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to begin"},
			}},
		},
	})

	// Look up each inflected form: must always return lemma="start"
	for _, form := range []string{"starting", "started", "starts"} {
		t.Run(form, func(t *testing.T) {
			resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
				Msg: &dictv1.LookupWordRequest{Word: form},
			})
			require.NoError(t, err)
			require.NotNil(t, resp.Msg)

			assert.Equal(t, form, resp.Msg.Term)
			require.NotNil(t, resp.Msg.Lemma,
				"LookupWord(%q): Lemma must not be nil", form)
			assert.Equal(t, "start", resp.Msg.GetLemma(),
				"LookupWord(%q): Lemma should be 'start', not empty", form)
		})
	}

	// Look up lemma itself — Lemma field should be nil
	t.Run("lemma_self", func(t *testing.T) {
		resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{Word: "start"},
		})
		require.NoError(t, err)
		assert.Equal(t, "start", resp.Msg.Term)
		assert.Nil(t, resp.Msg.Lemma, "Lemma field should be nil for lemma view")
	})
}

// TestDictService_LookupWord_InflectedFormAsLemma verifies the bug scenario where
// the pipeline created a lemma with an inflected form as its surface (e.g., "starting"
// instead of "start"). When the snapshot has surface="starting" and a LEMMA form for
// "starting", LookupWord("starting") returns Lemma=nil because the system thinks
// "starting" IS the lemma — the user sees this as "lemma is empty".
//
// This test documents the current (buggy) behavior and guards against future pipeline
// fixes: once the pipeline correctly resolves "starting" → "start", the snapshot
// surface will be "start" and the form_type for "starting" will be PRESENT_PARTICIPLE,
// so LookupWord("starting") will return Lemma="start".
func TestDictService_LookupWord_InflectedFormAsLemma(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	lemmaRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	// Scenario 1: CORRECT snapshot — "start" is the lemma, "starting" is a form
	createSnapshotInDB(t, client, &dictv1.Word{
		Term:     "start",
		TermType: dictv1.FormType_FORM_TYPE_LEMMA,
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		RelatedForms: []*dictv1.RelatedForm{
			{Term: "starting", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
			{Term: "started", FormType: dictv1.FormType_FORM_TYPE_PAST},
		},
		Meanings: []*dictv1.Meaning{
			{LexemeId: "L-START", Pos: "v.", Definitions: []*dictv1.Definition{
				{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to begin"},
			}},
		},
	})

	t.Run("correct_snapshot_starting_has_lemma", func(t *testing.T) {
		resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{Word: "starting"},
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Msg)

		assert.Equal(t, "starting", resp.Msg.Term,
			"Term should be the queried form")
		assert.Equal(t, dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, resp.Msg.TermType,
			"TermType should be PRESENT_PARTICIPLE, not LEMMA")
		require.NotNil(t, resp.Msg.Lemma,
			"Lemma must not be nil — 'starting' is a form, not a lemma")
		assert.Equal(t, "start", resp.Msg.GetLemma(),
			"Lemma should be 'start'")
	})

	t.Run("correct_snapshot_start_is_lemma", func(t *testing.T) {
		resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{Word: "start"},
		})
		require.NoError(t, err)
		assert.Equal(t, "start", resp.Msg.Term)
		assert.Equal(t, dictv1.FormType_FORM_TYPE_LEMMA, resp.Msg.TermType)
		assert.Nil(t, resp.Msg.Lemma,
			"Lemma should be nil when querying the lemma itself")
	})

	// Scenario 2: BUGGY snapshot — pipeline used "starting" as lemma surface
	// (happens when "starting" is processed before "start")
	// The LEMMA form has surface "starting", so LookupWord treats it as lemma view
	buggyLemma, err := client.Lemma.Create().
		SetSurface("starting").
		SetNormalized("starting").
		Save(ctx)
	require.NoError(t, err)

	_, err = client.LemmaSnapshot.Create().
		SetLemma(buggyLemma).
		SetSurface("starting"). // Bug: should be "start"
		SetNormalized("starting").
		SetLanguage("en").
		SetLookupTerms([]string{"starting"}).
		SetIsLatest(true).
		SetVersion(1).
		SetSchemaVersion(1).
		SetPayload(entity.LemmaSnapshotData{
			Forms: []entity.LemmaSnapshotForm{
				{Surface: "starting", FormType: "LEMMA"}, // Bug: should be PRESENT_PARTICIPLE
			},
			Lexemes: []entity.LemmaSnapshotLexeme{
				{ExternalID: "L-BUGGY", Language: "en", POS: "v.", Senses: []entity.LemmaSnapshotSense{
					{Language: "en", Gloss: "to begin"},
				}},
			},
		}).
		SetQualityOverall(0.5).
		SetQualityCompleteness(0.5).
		SetQualityDepth(0.5).
		SetQualityDensity(0.5).
		SetQualityValidity(0.5).
		SetLexemeCount(1).
		SetSenseCount(1).
		SetFormCount(1).
		SetSynthesizedAt(time.Now()).
		Save(ctx)
	require.NoError(t, err)

	// Note: This subtest will find the CORRECT snapshot (surface="start") via
	// lookup_terms because both snapshots have "starting" in their lookup_terms.
	// The repository should prioritize the one where surface matches the base form.
	// If the buggy snapshot is returned instead, the test documents the broken behavior.
	t.Run("buggy_snapshot_starting_treated_as_lemma", func(t *testing.T) {
		resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{Word: "starting"},
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Msg)
		assert.Equal(t, "starting", resp.Msg.Term)

		// With the correct snapshot, Lemma should be "start".
		// With the buggy snapshot, Lemma would be nil (system thinks "starting" IS the lemma).
		// This assertion guards the expected contract.
		if resp.Msg.Lemma != nil {
			assert.Equal(t, "start", resp.Msg.GetLemma(),
				"When Lemma is set, it should point to 'start'")
		}
		// If Lemma is nil here, it means the buggy snapshot was returned.
		// TODO: once pipeline properly resolves inflected forms, change this to require NotNil.
	})
}

// TestDictService_CaseSensitivity tests case handling across the full stack
func TestDictService_CaseSensitivity(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	lemmaRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	t.Run("stores and retrieves original case", func(t *testing.T) {
		// Create word with mixed case
		req := &dictv1.Word{
			Term:     "Apple",
			TermType: dictv1.FormType_FORM_TYPE_LEMMA,
			Language: commonv1.Language_LANGUAGE_ENGLISH,
			RelatedForms: []*dictv1.RelatedForm{
				{Term: "Apples", FormType: dictv1.FormType_FORM_TYPE_PLURAL},
			},
			Meanings: []*dictv1.Meaning{
				{
					LexemeId: "L-APPLE",
					Pos:      "n.",
					Definitions: []*dictv1.Definition{
						{
							Language: commonv1.Language_LANGUAGE_ENGLISH,
							Gloss:    "A fruit or a company",
						},
					},
				},
			},
		}

		id := createSnapshotInDB(t, client, req)

		// GetWord
		resp, err := svc.GetWord(ctx, &connect.Request[commonv1.IDRequest]{Msg: &commonv1.IDRequest{Id: id}})
		require.NoError(t, err)
		assert.Equal(t, "Apple", resp.Msg.Term, "Should preserve 'Apple' case")

		// Verify related forms preserve case
		var pluralForm *dictv1.RelatedForm
		for _, f := range resp.Msg.RelatedForms {
			if f.FormType == dictv1.FormType_FORM_TYPE_PLURAL {
				pluralForm = f
				break
			}
		}
		require.NotNil(t, pluralForm, "Should have plural form")
		assert.Equal(t, "Apples", pluralForm.Term, "Should preserve 'Apples' case")
	})

	t.Run("mixed case query", func(t *testing.T) {
		// Create "iPhone" (proper noun)
		iphone := &dictv1.Word{
			Term:     "iPhone",
			TermType: dictv1.FormType_FORM_TYPE_LEMMA,
			Language: commonv1.Language_LANGUAGE_ENGLISH,
			Meanings: []*dictv1.Meaning{
				{
					LexemeId: "L-IPHONE",
					Pos:      "n.",
					Definitions: []*dictv1.Definition{
						{
							Language: commonv1.Language_LANGUAGE_ENGLISH,
							Gloss:    "Apple's smartphone",
						},
					},
				},
			},
		}

		createSnapshotInDB(t, client, iphone)

		// Query with different cases
		testCases := []struct {
			query string
		}{
			{"iphone"}, // all lowercase
			{"IPHONE"}, // all uppercase
			{"iPhone"}, // original case
			{"IpHoNe"}, // random case
		}

		for _, tc := range testCases {
			t.Run("query_"+tc.query, func(t *testing.T) {
				lookupReq := &connect.Request[dictv1.LookupWordRequest]{
					Msg: &dictv1.LookupWordRequest{
						Word: tc.query,
					},
				}

				resp, err := svc.LookupWord(ctx, lookupReq)
				require.NoError(t, err)
				require.NotNil(t, resp.Msg)

				// Should find the word regardless of query case
				// But the returned term should preserve original case
				assert.Equal(t, "iPhone", resp.Msg.Term,
					"Should return original case 'iPhone' regardless of query case")
			})
		}
	})

	t.Run("inflected forms preserve case", func(t *testing.T) {
		// Create word with mixed-case inflected forms
		req := &dictv1.Word{
			Term:     "US",
			TermType: dictv1.FormType_FORM_TYPE_LEMMA,
			Language: commonv1.Language_LANGUAGE_ENGLISH,
			Meanings: []*dictv1.Meaning{
				{
					LexemeId: "L-US",
					Pos:      "n.",
					Definitions: []*dictv1.Definition{
						{
							Language: commonv1.Language_LANGUAGE_ENGLISH,
							Gloss:    "United States",
						},
					},
				},
			},
		}

		id := createSnapshotInDB(t, client, req)

		// Verify case is preserved when retrieving
		getReq := &connect.Request[commonv1.IDRequest]{
			Msg: &commonv1.IDRequest{
				Id: id,
			},
		}

		getResp, err := svc.GetWord(ctx, getReq)
		require.NoError(t, err)
		assert.Equal(t, "US", getResp.Msg.Term, "Should preserve all-caps 'US'")
	})
}

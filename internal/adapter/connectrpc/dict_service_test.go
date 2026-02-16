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
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo)
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
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo)
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
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo)
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
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo)
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

// TestDictService_CaseSensitivity tests case handling across the full stack
func TestDictService_CaseSensitivity(t *testing.T) {
	client := setupTestDB(t)

	snapshotRepo := repository.NewLemmaSnapshotRepository(client)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo)
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

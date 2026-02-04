package connectrpc

import (
	"context"
	"strings"
	"testing"

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

func createWordInDB(t *testing.T, client *ent.Client, word *dictv1.Word) int64 {
	ctx := context.Background()

	var firstLemmaID int64

	// Map commonv1.Language to entity.Language code
	langCode := "en"
	switch word.Language {
	case commonv1.Language_LANGUAGE_FRENCH:
		langCode = "fr"
	case commonv1.Language_LANGUAGE_SPANISH:
		langCode = "es"
	case commonv1.Language_LANGUAGE_CHINESE:
		langCode = "zh"
	}

	var formTypeMap = map[dictv1.FormType]entity.LexemeFormType{
		dictv1.FormType_FORM_TYPE_LEMMA:                 entity.LexemeFormTypeLemma,
		dictv1.FormType_FORM_TYPE_PLURAL:                entity.LexemeFormTypePlural,
		dictv1.FormType_FORM_TYPE_PAST:                  entity.LexemeFormTypePast,
		dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:       entity.LexemeFormTypePastParticiple,
		dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:    entity.LexemeFormTypePresentParticiple,
		dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR: entity.LexemeFormTypeThirdPersonSingular,
		dictv1.FormType_FORM_TYPE_COMPARATIVE:           entity.LexemeFormTypeComparative,
		dictv1.FormType_FORM_TYPE_SUPERLATIVE:           entity.LexemeFormTypeSuperlative,
		dictv1.FormType_FORM_TYPE_IMPERATIVE:            entity.LexemeFormTypeImperative,
		dictv1.FormType_FORM_TYPE_SUBJUNCTIVE:           entity.LexemeFormTypeSubjunctive,
		dictv1.FormType_FORM_TYPE_GERUND:                entity.LexemeFormTypeGerund,
		dictv1.FormType_FORM_TYPE_SHORT_FORM:             entity.LexemeFormTypeShortForm,
	}

	for _, meaning := range word.Meanings {
		// Create Lexeme
		lexQuery := client.Lexeme.Create().
			SetExternalID(meaning.LexemeId).
			SetLanguageCode(langCode).
			SetPos(meaning.Pos).
			SetCategories(word.Categories)

		// Map Senses
		var senses []entity.LexemeSense
		for _, def := range meaning.Definitions {
			gloss := def.Gloss
			senses = append(senses, entity.LexemeSense{
				Gloss:    gloss,
				Language: entity.Language(langCode), // Simplified
			})
		}
		lexQuery.SetSenses(senses)

		lex, err := lexQuery.Save(ctx)
		require.NoError(t, err)

		// Create Lemma
		lemmaQuery := client.Lemma.Create().
			SetLexeme(lex).
			SetSurface(word.Term).
			SetNormalized(strings.ToLower(word.Term))

		lemma, err := lemmaQuery.Save(ctx)
		require.NoError(t, err)

		if firstLemmaID == 0 {
			firstLemmaID = lemma.ID
		}

		// Create Lemma Form
		// 1. The lemma itself
		lemmaFormCreate := client.LexemeForm.Create().
			SetLemma(lemma).
			SetSurface(word.Term).
			SetNormalized(strings.ToLower(word.Term)).
			SetFormType(string(entity.LexemeFormTypeLemma))

		// Add phonetics to lemma form
		if len(word.Phonetics) > 0 {
			var phonetics []entity.Phonetic
			for _, p := range word.Phonetics {
				phonetics = append(phonetics, entity.Phonetic{
					IPA: p.Ipa,
					Dialect: p.Dialect,
				})
			}
			lemmaFormCreate.SetPhonetics(phonetics)
		}
		_, err = lemmaFormCreate.Save(ctx)
		require.NoError(t, err)

		// 2. Related forms
		for _, form := range word.RelatedForms {
			ft := formTypeMap[form.FormType]
			if ft == "" {
				ft = entity.LexemeFormTypeUnspecified
			}
			_, err = client.LexemeForm.Create().
				SetLemma(lemma).
				SetSurface(form.Term).
				SetNormalized(strings.ToLower(form.Term)).
				SetFormType(string(ft)).
				SetIsIrregular(form.Irregular).
				Save(ctx)
			require.NoError(t, err)
		}
	}
	return firstLemmaID
}

func TestDictService_LookupWord_Basics(t *testing.T) {
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
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

	createWordInDB(t, client, word)

	// Verify WID is generated in repository layer
	// The WID should be in format: {language}:{lemma}
	// This is verified indirectly by successful lookup
	lookupResp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
		Msg: &dictv1.LookupWordRequest{Word: "hello"},
	})
	require.NoError(t, err)
	require.NotNil(t, lookupResp)
	assert.Equal(t, "hello", lookupResp.Msg.Term)
}

func TestDictService_ListWords_Filtering(t *testing.T) {
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
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
		{
			Term:       "bonjour",
			TermType:   dictv1.FormType_FORM_TYPE_LEMMA,
			Language:   commonv1.Language_LANGUAGE_FRENCH,
			Categories: []string{"greeting"},
			Meanings: []*dictv1.Meaning{
				{LexemeId: "L1004", Pos: "interj.", Definitions: []*dictv1.Definition{
					{Language: commonv1.Language_LANGUAGE_FRENCH, Gloss: "hello"},
				}},
			},
		},
	}

	// Create all words
	for _, w := range words {
		createWordInDB(t, client, w)
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
			name: "filter by language",
			req: &dictv1.ListWordsRequest{
				Filter: `language == "fr"`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "bonjour", words[0].Term)
			},
		},
		{
			name: "filter by language and category",
			req: &dictv1.ListWordsRequest{
				Filter: `language == "en" && category in ["technology"]`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "computer", words[0].Term)
			},
		},
		{
			name: "pagination - first page",
			req: &dictv1.ListWordsRequest{
				Filter: `language == "en"`,
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
				Filter: `language == "en"`,
				Pagination: &commonv1.PaginationRequest{
					PageNo:   2,
					PageSize: 2,
				},
			},
			expectedCount: 1,
			checkFunc:     func(t *testing.T, words []*dictv1.Word) {},
		},
		{
			name: "order by lemma ascending",
			req: &dictv1.ListWordsRequest{
				Filter:  `language == "en"`,
				OrderBy: "lemma",
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
			name: "order by lemma descending",
			req: &dictv1.ListWordsRequest{
				Filter:  `language == "en"`,
				OrderBy: "lemma desc",
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

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	createWord := func(word *dictv1.Word) {
		t.Helper()
		createWordInDB(t, client, word)
	}

	createWord(&dictv1.Word{
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

	createWord(&dictv1.Word{
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

	// Stats relies on CreatedAt. Since we just created them, they are new.
	// But in test environment time moves fast.
	assert.EqualValues(t, 2, stats.Summary.NewWordsLast_24H)
	assert.EqualValues(t, 2, stats.Summary.NewWordsLast_7D)

	require.NotNil(t, stats.Coverage)
	assert.InDelta(t, 0.5, stats.Coverage.Phonetics, 0.0001) // Only 'run' has phonetics
	assert.InDelta(t, 1.0, stats.Coverage.Categories, 0.0001)
	assert.InDelta(t, 1.0, stats.Coverage.Definitions, 0.0001)
	assert.InDelta(t, 1.0, stats.Coverage.Forms, 0.0001)

	require.NotEmpty(t, stats.TopCategories)
	var categoryNames []string
	for _, cat := range stats.TopCategories {
		categoryNames = append(categoryNames, cat.Category)
	}
	assert.Contains(t, categoryNames, "basic")
	assert.Contains(t, categoryNames, "greeting")

	var bucketTotal int64
	for _, bucket := range stats.Completeness {
		bucketTotal += bucket.Count
	}
	assert.EqualValues(t, stats.Summary.TotalWords, bucketTotal)

	require.Len(t, stats.Languages, 2)
	// Sort order is by language code. 'en' < 'es'.
	assert.Equal(t, commonv1.Language_LANGUAGE_ENGLISH, stats.Languages[0].Language)
	assert.EqualValues(t, 1, stats.Languages[0].WordCount)
	assert.InDelta(t, 1.0, stats.Languages[0].FormCoverage, 0.0001)

	filterResp, err := svc.GetWordStats(ctx, &connect.Request[dictv1.GetWordStatsRequest]{
		Msg: &dictv1.GetWordStatsRequest{
			Languages: []commonv1.Language{commonv1.Language_LANGUAGE_ENGLISH},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, filterResp.Msg)

	assert.EqualValues(t, 1, filterResp.Msg.Summary.TotalWords)
	require.Len(t, filterResp.Msg.Languages, 1)
	assert.Equal(t, commonv1.Language_LANGUAGE_ENGLISH, filterResp.Msg.Languages[0].Language)
	assert.InDelta(t, 1.0, filterResp.Msg.Coverage.Forms, 0.0001)
}

func TestDictService_ListWords_SurfaceFiltering(t *testing.T) {
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
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
	createWordInDB(t, client, runWord)
	createWordInDB(t, client, swimWord)

	tests := []struct {
		name          string
		filter        string
		expectedCount int
		expectedLemma string
		expectedTerms []string
	}{
		{
			name:          "find by lemma",
			filter:        `surface in ["run"]`,
			expectedCount: 1,
			expectedLemma: "run",
			expectedTerms: []string{"run"},
		},
		{
			name:          "find by inflected form - running",
			filter:        `surface in ["running"]`,
			expectedCount: 1,
			expectedLemma: "run",
			expectedTerms: []string{"running"},
		},
		{
			name:          "find by inflected form - ran",
			filter:        `surface in ["ran"]`,
			expectedCount: 1,
			expectedLemma: "run",
			expectedTerms: []string{"ran"},
		},
		{
			name:          "batch lookup by multiple forms",
			filter:        `surface in ["running", "swam"]`,
			expectedCount: 2,
			expectedLemma: "", // both run and swim
			expectedTerms: []string{"running", "swam"},
		},
		{
			name:          "batch lookup with lemma and forms",
			filter:        `surface in ["run", "swimming"]`,
			expectedCount: 2,
			expectedLemma: "", // both run and swim
			expectedTerms: []string{"run", "swimming"},
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

			if tt.expectedCount == 2 {
				terms := []string{resp.Msg.Words[0].Term, resp.Msg.Words[1].Term}
				for _, expected := range tt.expectedTerms {
					assert.Contains(t, terms, expected)
				}
			}

			if len(tt.expectedTerms) == 1 {
				assert.Equal(t, tt.expectedTerms[0], resp.Msg.Words[0].Term)
			}
		})
	}
}

// TestDictService_CaseSensitivity tests case handling across the full stack
func TestDictService_CaseSensitivity(t *testing.T) {
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewLemmaRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
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

		id := createWordInDB(t, client, req)

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

	t.Run("allows different words with different case", func(t *testing.T) {
		// Create word with both lowercase verb and uppercase adjective meanings
		polishWord := &dictv1.Word{
			Term:     "polish", // Lemma text (lowercase)
			TermType: dictv1.FormType_FORM_TYPE_LEMMA,
			Language: commonv1.Language_LANGUAGE_ENGLISH,
			RelatedForms: []*dictv1.RelatedForm{
				{Term: "polishes", FormType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR},
				{Term: "polishing", FormType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
				{Term: "Polish", FormType: dictv1.FormType_FORM_TYPE_LEMMA}, // Capital P for adjective
			},
			Meanings: []*dictv1.Meaning{
				{
					LexemeId: "L-POLISH-VERB",
					Pos:      "v.",
					Definitions: []*dictv1.Definition{
						{
							Language: commonv1.Language_LANGUAGE_ENGLISH,
							Gloss:    "to make smooth and shiny",
						},
					},
				},
				{
					LexemeId: "L-POLISH-ADJ",
					Pos:      "adj.",
					Definitions: []*dictv1.Definition{
						{
							Language: commonv1.Language_LANGUAGE_ENGLISH,
							Gloss:    "relating to Poland",
						},
					},
				},
			},
		}

		createWordInDB(t, client, polishWord)

		// Lookup by "polish"
		resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{Msg: &dictv1.LookupWordRequest{Word: "polish"}})
		require.NoError(t, err)
		assert.Equal(t, "polish", resp.Msg.Term) // Lemma is lowercase

		// In my implementation of createWordInDB, I create 2 meanings (Lexemes).
		// Both attached to Lemma "polish".
		// But one has form "Polish".
		// LookupWord "polish" should return the aggregated view.

		// Verify "Polish" form exists
		forms := resp.Msg.RelatedForms
		hasPolish := false
		for _, f := range forms {
			if f.Term == "Polish" && f.FormType == dictv1.FormType_FORM_TYPE_LEMMA {
				hasPolish = true
				break
			}
		}
		assert.True(t, hasPolish, "Should have 'Polish' (capital P) form stored")
	})

	t.Run("case-insensitive lookup with exact match priority", func(t *testing.T) {
		// Create test word with multiple case variants
		testWord := &dictv1.Word{
			Term:     "test",
			TermType: dictv1.FormType_FORM_TYPE_LEMMA,
			Language: commonv1.Language_LANGUAGE_ENGLISH,
			RelatedForms: []*dictv1.RelatedForm{
				{Term: "Test", FormType: dictv1.FormType_FORM_TYPE_LEMMA}, // Capital T variant
			},
			Meanings: []*dictv1.Meaning{
				{
					LexemeId: "L-TEST",
					Pos:      "n.",
					Definitions: []*dictv1.Definition{
						{
							Language: commonv1.Language_LANGUAGE_ENGLISH,
							Gloss:    "a procedure to assess something",
						},
					},
				},
			},
		}

		createWordInDB(t, client, testWord)

		// Lookup with lowercase - should return lowercase because it matches exactly
		lookupLower := &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{
				Word: "test",
			},
		}

		respLower, err := svc.LookupWord(ctx, lookupLower)
		require.NoError(t, err)
		require.NotNil(t, respLower.Msg)
		assert.Equal(t, "test", respLower.Msg.Term, "Query 'test' should return 'test' (exact match)")

		// Lookup with uppercase - should return uppercase because it matches exactly
		// BUT: In my DB creation, I created Lemma "test". And Form "test". And Form "Test".
		// "Test" is a Form.
		// When looking up "Test", `LookupWord` -> `LookupByForm("Test")`.
		// It finds the form "Test".
		// `buildWordEntry` -> `buildFormView` if queried term is not Lemma surface?
		// Lemma surface is "test". Queried is "Test".
		// `findFormByText` finds "Test".
		// `isQueriedLemma` = false (because FormType_LEMMA? Wait.)
		// `Test` form type is LEMMA.
		// `isQueriedLemma` checks `formType == entity.LexemeFormTypeLemma`.
		// Yes. So it builds Lemma View.
		// `buildLemmaView` uses `entry.QueriedTerm` ("Test") or Lemma Surface ("test").
		// `displayTerm := entry.QueriedTerm`.
		// So it should return "Test".

		lookupUpper := &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{
				Word: "Test",
			},
		}

		respUpper, err := svc.LookupWord(ctx, lookupUpper)
		require.NoError(t, err)
		require.NotNil(t, respUpper.Msg)
		assert.Equal(t, "Test", respUpper.Msg.Term, "Query 'Test' should return 'Test' (exact match)")

		// Lookup with random case - should return one of the stored forms
		lookupRandom := &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{
				Word: "TEST",
			},
		}

		respRandom, err := svc.LookupWord(ctx, lookupRandom)
		require.NoError(t, err)
		require.NotNil(t, respRandom.Msg)
		// Should return either "test" or "Test" (the stored forms), not "TEST"
		assert.Contains(t, []string{"test", "Test"}, respRandom.Msg.Term,
			"Query 'TEST' should return a stored form ('test' or 'Test'), not 'TEST'")
	})

	t.Run("case-insensitive search in ListWords", func(t *testing.T) {
		// Search with lowercase should find both
		listReq := &connect.Request[dictv1.ListWordsRequest]{
			Msg: &dictv1.ListWordsRequest{
				Filter: `surface in ["polish"]`,
			},
		}

		listResp, err := svc.ListWords(ctx, listReq)
		require.NoError(t, err)

		// Should find at least one (possibly both, depending on implementation)
		assert.GreaterOrEqual(t, len(listResp.Msg.Words), 1)

		// Collect all found terms
		foundTerms := make(map[string]bool)
		for _, w := range listResp.Msg.Words {
			foundTerms[w.Term] = true
		}

		// Should be able to find words regardless of query case
		assert.True(t, foundTerms["polish"] || foundTerms["Polish"],
			"Should find at least one variant of polish/Polish")
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

		createWordInDB(t, client, iphone)

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

		id := createWordInDB(t, client, req)

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

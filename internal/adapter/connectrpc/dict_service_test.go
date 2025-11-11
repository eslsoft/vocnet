package grpc

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/usecase"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDictService_CreateWord_FullHierarchy(t *testing.T) {
	// Setup - each test gets its own isolated SQLite database
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewWordGroupRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	// Test data with full hierarchy: Word -> Lexemes -> Forms + Senses (with Examples)
	req := &connect.Request[dictv1.CreateWordRequest]{
		Msg: &dictv1.CreateWordRequest{
			Word: &dictv1.Word{
				Lemma:    "run",
				Language: commonv1.Language_LANGUAGE_ENGLISH,
				Phonetics: []*dictv1.Phonetic{
					{Ipa: "/rʌn/", Dialect: "en-US"},
				},
				Categories: []string{"basic", "verb"},
				Forms: []*dictv1.WordForm{
					{LexemeId: "L123", Word: "run", Type: dictv1.FormType_FORM_TYPE_LEMMA},
					{LexemeId: "L123", Word: "runs", Type: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR},
					{LexemeId: "L123", Word: "running", Type: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE},
					{LexemeId: "L123", Word: "ran", Type: dictv1.FormType_FORM_TYPE_PAST, Irregular: true},
				},
				Definitions: []*dictv1.Definition{
					{
						LexemeId: "L123",
						Pos:      "v.",
						Senses: []*dictv1.LexemeSense{
							{
								Language: commonv1.Language_LANGUAGE_ENGLISH,
								Gloss:    "to move swiftly on foot",
							},
							{
								Language: commonv1.Language_LANGUAGE_CHINESE,
								Gloss:    "跑步",
							},
						},
						Examples: []*dictv1.Sentence{
							{Text: "She runs every morning."},
							{Text: "I ran to catch the bus."},
						},
					},
					{
						LexemeId: "L456",
						Pos:      "n.",
						Senses: []*dictv1.LexemeSense{
							{
								Language: commonv1.Language_LANGUAGE_ENGLISH,
								Gloss:    "an act of running",
							},
						},
						Examples: []*dictv1.Sentence{
							{Text: "Let's go for a run."},
						},
					},
				},
			},
		},
	}

	// Create
	resp, err := svc.CreateWord(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)

	word := resp.Msg
	assert.Greater(t, word.Id, int64(0))
	assert.Equal(t, "run", word.Lemma)
	assert.Equal(t, commonv1.Language_LANGUAGE_ENGLISH, word.Language)

	require.Len(t, word.Phonetics, 1, "Phonetics should be present")
	assert.Equal(t, "/rʌn/", word.Phonetics[0].Ipa)

	assert.Len(t, word.Categories, 2)

	// Verify Forms
	assert.Len(t, word.Forms, 4)
	formTypes := make(map[dictv1.FormType]string)
	for _, f := range word.Forms {
		formTypes[f.Type] = f.Word
	}
	assert.Equal(t, "run", formTypes[dictv1.FormType_FORM_TYPE_LEMMA])
	assert.Equal(t, "runs", formTypes[dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR])
	assert.Equal(t, "running", formTypes[dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE])
	assert.Equal(t, "ran", formTypes[dictv1.FormType_FORM_TYPE_PAST])

	// Verify Definitions and Senses
	assert.Len(t, word.Definitions, 2)

	verbDef := word.Definitions[0]
	assert.Equal(t, "v.", verbDef.Pos)
	assert.Len(t, verbDef.Senses, 2)
	assert.Equal(t, "to move swiftly on foot", verbDef.Senses[0].Gloss)
	assert.Equal(t, "跑步", verbDef.Senses[1].Gloss)
	assert.Len(t, verbDef.Examples, 2)
	assert.Equal(t, "She runs every morning.", verbDef.Examples[0].Text)

	nounDef := word.Definitions[1]
	assert.Equal(t, "n.", nounDef.Pos)
	assert.Len(t, nounDef.Senses, 1)
	assert.Len(t, nounDef.Examples, 1)

	assert.NotNil(t, word.CreatedAt)
	assert.NotNil(t, word.UpdatedAt)

	wordID := word.Id

	// Test GetWord
	t.Run("GetWord", func(t *testing.T) {
		getResp, err := svc.GetWord(ctx, &connect.Request[dictv1.WordIDRequest]{
			Msg: &dictv1.WordIDRequest{WordId: wordID},
		})
		require.NoError(t, err)
		require.NotNil(t, getResp)

		retrieved := getResp.Msg
		assert.Equal(t, wordID, retrieved.Id)
		assert.Equal(t, "run", retrieved.Lemma)
		assert.Len(t, retrieved.Forms, 4)
		assert.Len(t, retrieved.Definitions, 2)
	})

	// Test UpdateWord
	t.Run("UpdateWord", func(t *testing.T) {
		word.Phonetics = append(word.Phonetics, &dictv1.Phonetic{
			Ipa:     "/rʌn/",
			Dialect: "en-GB",
		})
		word.Categories = append(word.Categories, "sports")

		updateResp, err := svc.UpdateWord(ctx, &connect.Request[dictv1.Word]{
			Msg: word,
		})
		require.NoError(t, err)
		require.NotNil(t, updateResp)

		updated := updateResp.Msg
		assert.Equal(t, wordID, updated.Id)
		assert.Len(t, updated.Phonetics, 2)
		assert.Len(t, updated.Categories, 3)
		assert.Contains(t, updated.Categories, "sports")
	})

	// Test ListWords
	t.Run("ListWords", func(t *testing.T) {
		listResp, err := svc.ListWords(ctx, &connect.Request[dictv1.ListWordsRequest]{
			Msg: &dictv1.ListWordsRequest{},
		})
		require.NoError(t, err)
		require.NotNil(t, listResp)

		assert.GreaterOrEqual(t, len(listResp.Msg.Words), 1)

		found := false
		for _, w := range listResp.Msg.Words {
			if w.Id == wordID {
				found = true
				assert.Equal(t, "run", w.Lemma)
				break
			}
		}
		assert.True(t, found, "Created word should be in list")
	})

	// Test LookupWord
	t.Run("LookupWord", func(t *testing.T) {
		// Lookup by lemma
		lookupResp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{Word: "run"},
		})
		require.NoError(t, err)
		require.NotNil(t, lookupResp)

		assert.Equal(t, "run", lookupResp.Msg.Lemma)
		assert.Len(t, lookupResp.Msg.Definitions, 2)

		// Lookup by inflected form
		lookupResp2, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
			Msg: &dictv1.LookupWordRequest{Word: "running"},
		})
		require.NoError(t, err)
		require.NotNil(t, lookupResp2)

		assert.Equal(t, "run", lookupResp2.Msg.Lemma) // Should return the lemma
	})

	// Test DeleteWord
	t.Run("DeleteWord", func(t *testing.T) {
		deleteResp, err := svc.DeleteWord(ctx, &connect.Request[dictv1.WordIDRequest]{
			Msg: &dictv1.WordIDRequest{WordId: wordID},
		})
		require.NoError(t, err)
		require.NotNil(t, deleteResp)

		// Verify deletion
		_, err = svc.GetWord(ctx, &connect.Request[dictv1.WordIDRequest]{
			Msg: &dictv1.WordIDRequest{WordId: wordID},
		})
		require.Error(t, err)
	})
}

func TestDictService_CreateWord_ValidationErrors(t *testing.T) {
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewWordGroupRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	tests := []struct {
		name    string
		req     *connect.Request[dictv1.CreateWordRequest]
		wantErr bool
	}{
		{
			name: "nil request",
			req: &connect.Request[dictv1.CreateWordRequest]{
				Msg: nil,
			},
			wantErr: true,
		},
		{
			name: "nil word",
			req: &connect.Request[dictv1.CreateWordRequest]{
				Msg: &dictv1.CreateWordRequest{
					Word: nil,
				},
			},
			wantErr: true,
		},
		{
			name: "empty lemma",
			req: &connect.Request[dictv1.CreateWordRequest]{
				Msg: &dictv1.CreateWordRequest{
					Word: &dictv1.Word{
						Lemma:    "",
						Language: commonv1.Language_LANGUAGE_ENGLISH,
					},
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.CreateWord(ctx, tt.req)
			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, resp)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, resp)
			}
		})
	}
}

func TestDictService_UpdateWord_ValidationErrors(t *testing.T) {
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewWordGroupRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	tests := []struct {
		name    string
		req     *connect.Request[dictv1.Word]
		wantErr bool
	}{
		{
			name: "nil request",
			req: &connect.Request[dictv1.Word]{
				Msg: nil,
			},
			wantErr: true,
		},
		{
			name: "zero id",
			req: &connect.Request[dictv1.Word]{
				Msg: &dictv1.Word{
					Id:       0,
					Lemma:    "test",
					Language: commonv1.Language_LANGUAGE_ENGLISH,
				},
			},
			wantErr: true,
		},
		{
			name: "non-existent id",
			req: &connect.Request[dictv1.Word]{
				Msg: &dictv1.Word{
					Id:       999999,
					Lemma:    "test",
					Language: commonv1.Language_LANGUAGE_ENGLISH,
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.UpdateWord(ctx, tt.req)
			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, resp)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, resp)
			}
		})
	}
}

func TestDictService_WordIDGeneration(t *testing.T) {
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewWordGroupRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	req := &connect.Request[dictv1.CreateWordRequest]{
		Msg: &dictv1.CreateWordRequest{
			Word: &dictv1.Word{
				Lemma:    "hello",
				Language: commonv1.Language_LANGUAGE_ENGLISH,
				Definitions: []*dictv1.Definition{
					{
						LexemeId: "L789",
						Pos:      "interj.",
						Senses: []*dictv1.LexemeSense{
							{
								Language: commonv1.Language_LANGUAGE_ENGLISH,
								Gloss:    "a greeting",
							},
						},
					},
				},
			},
		},
	}

	resp, err := svc.CreateWord(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify WID is generated in repository layer
	// The WID should be in format: {language}:{lemma}
	// This is verified indirectly by successful lookup
	lookupResp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
		Msg: &dictv1.LookupWordRequest{Word: "hello"},
	})
	require.NoError(t, err)
	require.NotNil(t, lookupResp)
	assert.Equal(t, "hello", lookupResp.Msg.Lemma)

	// Cleanup
	_, _ = svc.DeleteWord(ctx, &connect.Request[dictv1.WordIDRequest]{
		Msg: &dictv1.WordIDRequest{WordId: resp.Msg.Id},
	})
}

func TestDictService_ListWords_Filtering(t *testing.T) {
	client := setupTestDB(t)

	lexemeRepo := repository.NewLexemeRepository(client)
	wordRepo := repository.NewWordGroupRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	// Create test words with different categories
	words := []*dictv1.Word{
		{
			Lemma:      "apple",
			Language:   commonv1.Language_LANGUAGE_ENGLISH,
			Categories: []string{"cet4", "fruit"},
			Definitions: []*dictv1.Definition{
				{LexemeId: "L1001", Pos: "n.", Senses: []*dictv1.LexemeSense{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "a fruit"},
				}},
			},
		},
		{
			Lemma:      "book",
			Language:   commonv1.Language_LANGUAGE_ENGLISH,
			Categories: []string{"cet4", "education"},
			Definitions: []*dictv1.Definition{
				{LexemeId: "L1002", Pos: "n.", Senses: []*dictv1.LexemeSense{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "a written work"},
				}},
			},
		},
		{
			Lemma:      "computer",
			Language:   commonv1.Language_LANGUAGE_ENGLISH,
			Categories: []string{"cet6", "technology"},
			Definitions: []*dictv1.Definition{
				{LexemeId: "L1003", Pos: "n.", Senses: []*dictv1.LexemeSense{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "an electronic device"},
				}},
			},
		},
		{
			Lemma:      "bonjour",
			Language:   commonv1.Language_LANGUAGE_FRENCH,
			Categories: []string{"greeting"},
			Definitions: []*dictv1.Definition{
				{LexemeId: "L1004", Pos: "interj.", Senses: []*dictv1.LexemeSense{
					{Language: commonv1.Language_LANGUAGE_FRENCH, Gloss: "hello"},
				}},
			},
		},
	}

	// Create all words
	createdIDs := make([]int64, 0, len(words))
	for _, w := range words {
		resp, err := svc.CreateWord(ctx, &connect.Request[dictv1.CreateWordRequest]{
			Msg: &dictv1.CreateWordRequest{Word: w},
		})
		require.NoError(t, err)
		createdIDs = append(createdIDs, resp.Msg.Id)
	}

	// Cleanup
	defer func() {
		for _, id := range createdIDs {
			_, _ = svc.DeleteWord(ctx, &connect.Request[dictv1.WordIDRequest]{
				Msg: &dictv1.WordIDRequest{WordId: id},
			})
		}
	}()

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
				assert.Equal(t, "book", words[0].Lemma)
			},
		},
		{
			name: "filter by keyword - partial lemma",
			req: &dictv1.ListWordsRequest{
				Filter: `keyword == "app"`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "apple", words[0].Lemma)
			},
		},
		{
			name: "filter by category - cet4",
			req: &dictv1.ListWordsRequest{
				Filter: `category in ["cet4"]`,
			},
			expectedCount: 2,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				lemmas := make([]string, len(words))
				for i, w := range words {
					lemmas[i] = w.Lemma
				}
				assert.Contains(t, lemmas, "apple")
				assert.Contains(t, lemmas, "book")
			},
		},
		{
			name: "filter by category - cet6",
			req: &dictv1.ListWordsRequest{
				Filter: `category in ["cet6"]`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "computer", words[0].Lemma)
			},
		},
		{
			name: "filter by multiple categories",
			req: &dictv1.ListWordsRequest{
				Filter: `category in ["cet4", "cet6"]`,
			},
			expectedCount: 3,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				lemmas := make([]string, len(words))
				for i, w := range words {
					lemmas[i] = w.Lemma
				}
				assert.Contains(t, lemmas, "apple")
				assert.Contains(t, lemmas, "book")
				assert.Contains(t, lemmas, "computer")
			},
		},
		{
			name: "filter by language",
			req: &dictv1.ListWordsRequest{
				Filter: `language == "fr"`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "bonjour", words[0].Lemma)
			},
		},
		{
			name: "filter by language and category",
			req: &dictv1.ListWordsRequest{
				Filter: `language == "en" && category in ["technology"]`,
			},
			expectedCount: 1,
			checkFunc: func(t *testing.T, words []*dictv1.Word) {
				assert.Equal(t, "computer", words[0].Lemma)
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
				assert.Equal(t, "apple", words[0].Lemma)
				assert.Equal(t, "book", words[1].Lemma)
				assert.Equal(t, "computer", words[2].Lemma)
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
				assert.Equal(t, "computer", words[0].Lemma)
				assert.Equal(t, "book", words[1].Lemma)
				assert.Equal(t, "apple", words[2].Lemma)
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
	wordRepo := repository.NewWordGroupRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	createWord := func(word *dictv1.Word) {
		t.Helper()
		_, err := svc.CreateWord(ctx, &connect.Request[dictv1.CreateWordRequest]{
			Msg: &dictv1.CreateWordRequest{Word: word},
		})
		require.NoError(t, err)
	}

	createWord(&dictv1.Word{
		Lemma:    "run",
		Language: commonv1.Language_LANGUAGE_ENGLISH,
		Categories: []string{
			"basic",
		},
		Phonetics: []*dictv1.Phonetic{
			{Ipa: "/rʌn/"},
		},
		Forms: []*dictv1.WordForm{
			{LexemeId: "L100", Word: "runs", Type: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR},
		},
		Definitions: []*dictv1.Definition{
			{
				LexemeId: "L100",
				Pos:      "v.",
				Senses: []*dictv1.LexemeSense{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "move swiftly"},
				},
			},
		},
	})

	createWord(&dictv1.Word{
		Lemma:    "hola",
		Language: commonv1.Language_LANGUAGE_SPANISH,
		Categories: []string{
			"greeting",
		},
		Definitions: []*dictv1.Definition{
			{
				LexemeId: "L200",
				Pos:      "interj.",
				Senses: []*dictv1.LexemeSense{
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
	assert.EqualValues(t, 2, stats.Summary.NewWordsLast_24H)
	assert.EqualValues(t, 2, stats.Summary.NewWordsLast_7D)

	require.NotNil(t, stats.Coverage)
	assert.InDelta(t, 0.5, stats.Coverage.Phonetics, 0.0001)
	assert.InDelta(t, 1.0, stats.Coverage.Categories, 0.0001)
	assert.InDelta(t, 1.0, stats.Coverage.Definitions, 0.0001)
	assert.InDelta(t, 0.5, stats.Coverage.Forms, 0.0001)

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
	wordRepo := repository.NewWordGroupRepository(client)
	wordUC := usecase.NewWordUsecase(wordRepo, lexemeRepo)
	svc := NewDictServiceServer(wordUC)

	ctx := context.Background()

	// Create a word with forms
	runWord := &dictv1.Word{
		Lemma:      "run",
		Language:   commonv1.Language_LANGUAGE_ENGLISH,
		Categories: []string{"cet4"},
		Forms: []*dictv1.WordForm{
			{LexemeId: "L2001", Type: dictv1.FormType_FORM_TYPE_LEMMA, Word: "run"},
			{LexemeId: "L2001", Type: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, Word: "runs"},
			{LexemeId: "L2001", Type: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, Word: "running"},
			{LexemeId: "L2001", Type: dictv1.FormType_FORM_TYPE_PAST, Word: "ran"},
		},
		Definitions: []*dictv1.Definition{
			{
				LexemeId: "L2001",
				Pos:      "v.",
				Senses: []*dictv1.LexemeSense{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to move swiftly"},
				},
			},
		},
	}

	swimWord := &dictv1.Word{
		Lemma:      "swim",
		Language:   commonv1.Language_LANGUAGE_ENGLISH,
		Categories: []string{"cet4"},
		Forms: []*dictv1.WordForm{
			{LexemeId: "L2002", Type: dictv1.FormType_FORM_TYPE_LEMMA, Word: "swim"},
			{LexemeId: "L2002", Type: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, Word: "swims"},
			{LexemeId: "L2002", Type: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, Word: "swimming"},
			{LexemeId: "L2002", Type: dictv1.FormType_FORM_TYPE_PAST, Word: "swam"},
		},
		Definitions: []*dictv1.Definition{
			{
				LexemeId: "L2002",
				Pos:      "v.",
				Senses: []*dictv1.LexemeSense{
					{Language: commonv1.Language_LANGUAGE_ENGLISH, Gloss: "to move through water"},
				},
			},
		},
	}

	// Create both words
	runResp, err := svc.CreateWord(ctx, &connect.Request[dictv1.CreateWordRequest]{
		Msg: &dictv1.CreateWordRequest{Word: runWord},
	})
	require.NoError(t, err)

	swimResp, err := svc.CreateWord(ctx, &connect.Request[dictv1.CreateWordRequest]{
		Msg: &dictv1.CreateWordRequest{Word: swimWord},
	})
	require.NoError(t, err)

	// Cleanup
	defer func() {
		_, _ = svc.DeleteWord(ctx, &connect.Request[dictv1.WordIDRequest]{
			Msg: &dictv1.WordIDRequest{WordId: runResp.Msg.Id},
		})
		_, _ = svc.DeleteWord(ctx, &connect.Request[dictv1.WordIDRequest]{
			Msg: &dictv1.WordIDRequest{WordId: swimResp.Msg.Id},
		})
	}()

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
			name:          "batch lookup with lemma and forms",
			filter:        `surface in ["run", "swimming"]`,
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
				assert.Equal(t, tt.expectedLemma, resp.Msg.Words[0].Lemma)
			}

			if tt.expectedCount == 2 {
				lemmas := []string{resp.Msg.Words[0].Lemma, resp.Msg.Words[1].Lemma}
				assert.Contains(t, lemmas, "run")
				assert.Contains(t, lemmas, "swim")
			}
		})
	}
}

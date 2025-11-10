package grpc

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/enttest"
	"github.com/eslsoft/vocnet/internal/usecase"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	_ "github.com/lib/pq"
)

func TestDictService_CreateWord_FullHierarchy(t *testing.T) {
	// Setup
	client := enttest.Open(t, "postgres", "host=localhost port=5432 user=postgres password=postgres dbname=vocnet_test sslmode=disable")
	defer client.Close()

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
	client := enttest.Open(t, "postgres", "host=localhost port=5432 user=postgres password=postgres dbname=vocnet_test sslmode=disable")
	defer client.Close()

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
	client := enttest.Open(t, "postgres", "host=localhost port=5432 user=postgres password=postgres dbname=vocnet_test sslmode=disable")
	defer client.Close()

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
	client := enttest.Open(t, "postgres", "host=localhost port=5432 user=postgres password=postgres dbname=vocnet_test sslmode=disable")
	defer client.Close()

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

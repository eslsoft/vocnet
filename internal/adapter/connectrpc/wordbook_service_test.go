package connectrpc

import (
	"context"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	repo "github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	wordbookv1 "github.com/eslsoft/vocnet/pkg/api/wordbook/v1"
	"github.com/eslsoft/vocnet/pkg/wordbook"
)

func TestWordbookService_BuiltinListing(t *testing.T) {
	svc := setupWordbookService(t)
	ctx := context.Background()

	tests := []struct {
		name           string
		req            *wordbookv1.ListWordbooksRequest
		expectedTotal  int32
		expectedLen    int
		expectedPageNo int32
	}{
		{
			name: "list all wordbooks with default pagination",
			req: &wordbookv1.ListWordbooksRequest{
				Pagination: &commonv1.PaginationRequest{
					PageNo:   1,
					PageSize: 20,
				},
			},
			expectedTotal:  15,
			expectedLen:    15,
			expectedPageNo: 1,
		},
		{
			name: "list wordbooks with small page size",
			req: &wordbookv1.ListWordbooksRequest{
				Pagination: &commonv1.PaginationRequest{
					PageNo:   1,
					PageSize: 5,
				},
			},
			expectedTotal:  15,
			expectedLen:    5,
			expectedPageNo: 1,
		},
		{
			name: "list wordbooks second page",
			req: &wordbookv1.ListWordbooksRequest{
				Pagination: &commonv1.PaginationRequest{
					PageNo:   2,
					PageSize: 5,
				},
			},
			expectedTotal:  15,
			expectedLen:    5,
			expectedPageNo: 2,
		},
		{
			name: "list wordbooks with no pagination",
			req: &wordbookv1.ListWordbooksRequest{
				Pagination: nil,
			},
			expectedTotal:  15,
			expectedLen:    15,
			expectedPageNo: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.ListWordbooks(ctx, connect.NewRequest(tt.req))
			require.NoError(t, err)
			require.NotNil(t, resp)

			assert.Equal(t, tt.expectedTotal, resp.Msg.Pagination.Total)
			assert.Equal(t, tt.expectedPageNo, resp.Msg.Pagination.PageNo)
			assert.Len(t, resp.Msg.Wordbooks, tt.expectedLen)

			for _, wb := range resp.Msg.Wordbooks {
				assert.NotZero(t, wb.Id)
				assert.NotEmpty(t, wb.Name)
				assert.NotNil(t, wb.Terms)
				assert.Greater(t, len(wb.Terms), 0)
			}
		})
	}
}

func TestWordbookService_UserOperations(t *testing.T) {
	svc := setupWordbookService(t)
	ctx := context.Background()

	// Create
	createReq := connect.NewRequest(&wordbookv1.CreateWordbookRequest{
		Language:    commonv1.Language_LANGUAGE_ENGLISH,
		Visibility:  wordbookv1.VisibilityType_VISIBILITY_TYPE_PRIVATE,
		Name:        "My Custom Book",
		Description: "A personal list",
	})
	createReq.Header().Set("x-user-id", "42")
	createdResp, err := svc.CreateWordbook(ctx, createReq)
	require.NoError(t, err)
	require.NotNil(t, createdResp)
	created := createdResp.Msg
	assert.NotZero(t, created.Id)
	assert.Equal(t, "My Custom Book", created.Name)
	assert.Equal(t, wordbookv1.VisibilityType_VISIBILITY_TYPE_PRIVATE, created.Visibility)

	bookID := created.Id

	// Update
	updateReq := connect.NewRequest(&wordbookv1.UpdateWordbookRequest{
		Id:          bookID,
		Visibility:  wordbookv1.VisibilityType_VISIBILITY_TYPE_PUBLIC,
		Name:        "Updated Book",
		Description: "Updated description",
	})
	updateReq.Header().Set("x-user-id", "42")
	updateResp, err := svc.UpdateWordbook(ctx, updateReq)
	require.NoError(t, err)
	assert.Equal(t, "Updated Book", updateResp.Msg.Name)

	// Add words
	addReq := connect.NewRequest(&wordbookv1.WordsActionRequest{
		WordbookId: bookID,
		Terms:      []string{"alpha", "beta", "alpha"},
	})
	addReq.Header().Set("x-user-id", "42")
	addResp, err := svc.AddWords(ctx, addReq)
	require.NoError(t, err)
	assert.Len(t, addResp.Msg.Terms, 2)

	// Remove word
	removeReq := connect.NewRequest(&wordbookv1.WordsActionRequest{
		WordbookId: bookID,
		Terms:      []string{"beta"},
	})
	removeReq.Header().Set("x-user-id", "42")
	removeResp, err := svc.RemoveWords(ctx, removeReq)
	require.NoError(t, err)
	assert.Len(t, removeResp.Msg.Terms, 1)
	assert.Equal(t, "alpha", removeResp.Msg.Terms[0])

	// Delete
	delReq := connect.NewRequest(&commonv1.IDRequest{Id: bookID})
	delReq.Header().Set("x-user-id", "42")
	_, err = svc.DeleteWordbook(ctx, delReq)
	require.NoError(t, err)

	// Ensure deletion
	_, err = svc.GetWordbook(ctx, connect.NewRequest(&commonv1.IDRequest{Id: bookID}))
	assert.Error(t, err)
}

func TestWordbookService_GetBuiltin(t *testing.T) {
	svc := setupWordbookService(t)
	ctx := context.Background()

	resp, err := svc.GetWordbook(ctx, connect.NewRequest(&commonv1.IDRequest{Id: 101}))
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, int64(101), resp.Msg.Id)
	assert.NotEmpty(t, resp.Msg.Terms)
}

func TestWordbookService_BuiltinIsReadOnly(t *testing.T) {
	svc := setupWordbookService(t)
	ctx := context.Background()
	header := http.Header{}
	header.Set("x-user-id", "1")

	req := connect.NewRequest(&wordbookv1.UpdateWordbookRequest{
		Id:          101,
		Name:        "should fail",
		Visibility:  wordbookv1.VisibilityType_VISIBILITY_TYPE_PRIVATE,
		Description: "x",
	})
	req.Header().Set("x-user-id", "1")
	_, err := svc.UpdateWordbook(ctx, req)
	assert.Error(t, err)
}

func setupWordbookService(t *testing.T) *WordbookServiceServer {
	t.Helper()
	client := setupTestDB(t)

	wordbookRepo := repo.NewWordbookRepository(client)
	learnedRepo := repo.NewLearnedWordRepository(client, wordbookRepo)
	wordbookUC := usecase.NewWordbookUsecase(wordbookRepo, learnedRepo)
	require.NoError(t, wordbookUC.SyncBuiltin(context.Background(), loadBuiltinEntities()))

	return NewWordbookServiceServer(wordbookUC)
}

func loadBuiltinEntities() []*entity.Wordbook {
	builtin := wordbook.GetBuiltinWordbooks()
	books := make([]*entity.Wordbook, 0, len(builtin))
	for idx, wb := range builtin {
		ent := mapping.ToEntityWordbook(wb)
		if ent == nil {
			continue
		}
		ent.Source = entity.WordbookSourceBuiltin
		ent.SortOrder = int32(idx + 1)
		books = append(books, ent)
	}
	return books
}

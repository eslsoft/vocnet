package connectrpc

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	wordbookv1 "github.com/eslsoft/vocnet/pkg/api/wordbook/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWordbookServiceServer_ListWordbooks(t *testing.T) {
	server := NewWordbookServiceServer()

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
			expectedTotal:  15, // Total builtin wordbooks
			expectedLen:    15, // All wordbooks fit in one page
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
			resp, err := server.ListWordbooks(context.Background(), connect.NewRequest(tt.req))
			require.NoError(t, err)
			require.NotNil(t, resp)

			assert.Equal(t, tt.expectedTotal, resp.Msg.Pagination.Total)
			assert.Equal(t, tt.expectedPageNo, resp.Msg.Pagination.PageNo)
			assert.Len(t, resp.Msg.Wordbooks, tt.expectedLen)

			// Verify wordbooks have required fields
			for _, wb := range resp.Msg.Wordbooks {
				assert.NotZero(t, wb.Id)
				assert.NotEmpty(t, wb.Name)
				assert.NotNil(t, wb.Terms)
			}
		})
	}
}

func TestWordbookServiceServer_GetWordbook(t *testing.T) {
	server := NewWordbookServiceServer()

	tests := []struct {
		name        string
		id          int64
		expectError bool
		expectedID  int64
	}{
		{
			name:        "get existing wordbook - CEFR-A1",
			id:          101,
			expectError: false,
			expectedID:  101,
		},
		{
			name:        "get existing wordbook - CET4",
			id:          109,
			expectError: false,
			expectedID:  109,
		},
		{
			name:        "get non-existent wordbook",
			id:          999,
			expectError: true,
		},
		{
			name:        "get wordbook with invalid id",
			id:          0,
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := &commonv1.IDRequest{Id: tt.id}
			resp, err := server.GetWordbook(context.Background(), connect.NewRequest(req))

			if tt.expectError {
				assert.Error(t, err)
				assert.Nil(t, resp)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				assert.Equal(t, tt.expectedID, resp.Msg.Id)
				assert.NotEmpty(t, resp.Msg.Name)
				assert.NotNil(t, resp.Msg.Terms)
				assert.Greater(t, len(resp.Msg.Terms), 0, "wordbook should have terms")
			}
		})
	}
}

func TestWordbookServiceServer_UnimplementedMethods(t *testing.T) {
	server := NewWordbookServiceServer()

	t.Run("CreateWordbook returns unimplemented", func(t *testing.T) {
		req := &wordbookv1.CreateWordbookRequest{
			Name: "Test Wordbook",
		}
		resp, err := server.CreateWordbook(context.Background(), connect.NewRequest(req))
		assert.Error(t, err)
		assert.Nil(t, resp)
	})

	t.Run("UpdateWordbook returns unimplemented", func(t *testing.T) {
		req := &wordbookv1.UpdateWordbookRequest{
			Id:   101,
			Name: "Updated Name",
		}
		resp, err := server.UpdateWordbook(context.Background(), connect.NewRequest(req))
		assert.Error(t, err)
		assert.Nil(t, resp)
	})

	t.Run("DeleteWordbook returns unimplemented", func(t *testing.T) {
		req := &commonv1.IDRequest{Id: 101}
		resp, err := server.DeleteWordbook(context.Background(), connect.NewRequest(req))
		assert.Error(t, err)
		assert.Nil(t, resp)
	})

	t.Run("AddWords returns unimplemented", func(t *testing.T) {
		req := &wordbookv1.WordsActionRequest{
			WordbookId: 101,
			Terms:      []string{"test"},
		}
		resp, err := server.AddWords(context.Background(), connect.NewRequest(req))
		assert.Error(t, err)
		assert.Nil(t, resp)
	})

	t.Run("RemoveWords returns unimplemented", func(t *testing.T) {
		req := &wordbookv1.WordsActionRequest{
			WordbookId: 101,
			Terms:      []string{"test"},
		}
		resp, err := server.RemoveWords(context.Background(), connect.NewRequest(req))
		assert.Error(t, err)
		assert.Nil(t, resp)
	})
}

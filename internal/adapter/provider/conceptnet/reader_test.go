package conceptnet

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractTermLabel(t *testing.T) {
	tests := []struct {
		name string
		uri  string
		want string
	}{
		{
			name: "bare term",
			uri:  "/c/en/hello",
			want: "hello",
		},
		{
			name: "term with POS suffix /v",
			uri:  "/c/en/run/v",
			want: "run",
		},
		{
			name: "term with POS suffix /n",
			uri:  "/c/en/bank/n",
			want: "bank",
		},
		{
			name: "term with POS and sense",
			uri:  "/c/en/bank/n/wn/bank_1",
			want: "bank",
		},
		{
			name: "multi-word term (underscore)",
			uri:  "/c/en/hot_dog/n",
			want: "hot_dog",
		},
		{
			name: "non-English language",
			uri:  "/c/zh/跑/v",
			want: "跑",
		},
		{
			name: "empty string",
			uri:  "",
			want: "",
		},
		{
			name: "relation URI (not a concept)",
			uri:  "/r/Synonym",
			want: "",
		},
		{
			name: "too short",
			uri:  "/c/en",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractTermLabel(tt.uri)
			require.Equal(t, tt.want, got)
		})
	}
}

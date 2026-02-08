package pipeline

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseTerms_TXT(t *testing.T) {
	input := `hello
world

# this is a comment
  apple
banana
`
	terms, err := ParseTerms(strings.NewReader(input), ".txt")
	require.NoError(t, err)
	assert.Equal(t, []string{"hello", "world", "apple", "banana"}, terms)
}

func TestParseTerms_JSON(t *testing.T) {
	input := `["hello", "world", " apple ", "banana"]`
	terms, err := ParseTerms(strings.NewReader(input), ".json")
	require.NoError(t, err)
	assert.Equal(t, []string{"hello", "world", "apple", "banana"}, terms)
}

func TestParseTerms_JSONEmpty(t *testing.T) {
	input := `[]`
	terms, err := ParseTerms(strings.NewReader(input), ".json")
	require.NoError(t, err)
	assert.Empty(t, terms)
}

func TestParseTerms_AutoDetectJSON(t *testing.T) {
	input := `["cat", "dog"]`
	terms, err := ParseTerms(strings.NewReader(input), "")
	require.NoError(t, err)
	assert.Equal(t, []string{"cat", "dog"}, terms)
}

func TestParseTerms_AutoDetectTXT(t *testing.T) {
	input := "cat\ndog\n"
	terms, err := ParseTerms(strings.NewReader(input), "")
	require.NoError(t, err)
	assert.Equal(t, []string{"cat", "dog"}, terms)
}

func TestParseTerms_TXTSkipsBlanksAndComments(t *testing.T) {
	input := `
# header comment
hello

# another comment

world
`
	terms, err := ParseTerms(strings.NewReader(input), ".txt")
	require.NoError(t, err)
	assert.Equal(t, []string{"hello", "world"}, terms)
}

func TestParseTerms_JSONInvalid(t *testing.T) {
	input := `not json at all`
	_, err := ParseTerms(strings.NewReader(input), ".json")
	assert.Error(t, err)
}

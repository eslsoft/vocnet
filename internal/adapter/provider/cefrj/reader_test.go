package cefrj

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReaderLookup_MultiPOSReturnsMinLevel(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	csvPath := filepath.Join(dir, "cefrj.csv")
	content := "headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold\n" +
		"address,noun,A1,,,\n" +
		"address,verb,B1,,,\n" +
		"a.m./A.M./am/AM,adverb,A1,,,\n"
	require.NoError(t, os.WriteFile(csvPath, []byte(content), 0644))

	r, err := NewReader(csvPath)
	require.NoError(t, err)

	entry, err := r.Lookup(context.Background(), "address")
	require.NoError(t, err)
	require.NotNil(t, entry)
	require.Equal(t, "A1", entry.MinLevel)
	require.Equal(t, "A1", entry.LevelsByPOS["noun"])
	require.Equal(t, "B1", entry.LevelsByPOS["verb"])

	am, err := r.Lookup(context.Background(), "AM")
	require.NoError(t, err)
	require.NotNil(t, am)
	require.Equal(t, "A1", am.MinLevel)
}

func TestReaderLookup_NotFound(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	csvPath := filepath.Join(dir, "cefrj.csv")
	content := "headword,pos,CEFR\nhello,noun,A1\n"
	require.NoError(t, os.WriteFile(csvPath, []byte(content), 0644))

	r, err := NewReader(csvPath)
	require.NoError(t, err)

	entry, err := r.Lookup(context.Background(), "world")
	require.NoError(t, err)
	require.Nil(t, entry)
}

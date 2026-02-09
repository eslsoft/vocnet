package pipeline

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/require"
)

func TestCEFRJProcessor_Process(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	csvPath := filepath.Join(dir, "cefrj.csv")
	content := "headword,pos,CEFR\n" +
		"address,noun,A1\n" +
		"address,verb,B1\n"
	require.NoError(t, os.WriteFile(csvPath, []byte(content), 0644))

	reader, err := cefrj.NewReader(csvPath)
	require.NoError(t, err)

	p := NewCEFRJProcessor(reader)
	ctx := &PipelineContext{
		Term: "address",
		Lemma: &entity.Lemma{
			ID:      1,
			Surface: "address",
		},
	}

	res, err := p.Process(context.Background(), ctx)
	require.NoError(t, err)
	require.NotNil(t, res)
	require.Equal(t, ProcessStatusExecuted, res.Status)
	require.NotNil(t, res.LemmaUpdate)
	require.Equal(t, "A1", res.LemmaUpdate.Level)
	require.Len(t, res.Evidence, 1)
	require.Equal(t, "cefrj", res.Evidence[0].Provider)
	require.Equal(t, "cefrj-1.5", res.Evidence[0].SchemaVersion)
}

func TestCEFRJProcessor_KeepLowerLevel(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	csvPath := filepath.Join(dir, "cefrj.csv")
	content := "headword,pos,CEFR\n" +
		"address,noun,B1\n"
	require.NoError(t, os.WriteFile(csvPath, []byte(content), 0644))

	reader, err := cefrj.NewReader(csvPath)
	require.NoError(t, err)

	p := NewCEFRJProcessor(reader)
	ctx := &PipelineContext{
		Term: "address",
		Lemma: &entity.Lemma{
			ID:      1,
			Surface: "address",
			Level:   "A2",
		},
	}

	res, err := p.Process(context.Background(), ctx)
	require.NoError(t, err)
	require.Equal(t, "A2", res.LemmaUpdate.Level)
}

func TestCEFRJProcessor_SkippedWhenReaderMissing(t *testing.T) {
	t.Parallel()
	p := NewCEFRJProcessor(nil)
	_, err := p.Process(context.Background(), &PipelineContext{Lemma: &entity.Lemma{}})
	require.Error(t, err)
	require.True(t, IsProcessorSkipped(err))
}

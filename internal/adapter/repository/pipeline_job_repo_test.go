package repository

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

func newTestJobRepo(t *testing.T) (*pipelineJobRepository, *entdb.Client) {
	t.Helper()

	dsn := "file:" + filepath.Join(t.TempDir(), "jobs.db") + "?_fk=1&cache=shared"
	rawDB, err := sql.Open("sqlite", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = rawDB.Close() })

	_, err = rawDB.Exec("PRAGMA foreign_keys = ON")
	require.NoError(t, err)

	drv := entsql.OpenDB(dialect.SQLite, rawDB)
	client := entdb.NewClient(entdb.Driver(drv))
	require.NoError(t, client.Schema.Create(context.Background()))
	t.Cleanup(func() { _ = client.Close() })

	return &pipelineJobRepository{client: client}, client
}

func TestPipelineJobRepositoryCreate_ReusesActiveSingleWordJob(t *testing.T) {
	repo, client := newTestJobRepo(t)
	ctx := context.Background()

	first, err := repo.Create(ctx, &entity.PipelineJob{
		Status:     entity.JobStatusPending,
		Name:       "word: graph",
		Language:   "en",
		Tier:       2,
		Term:       "graph",
		TotalTerms: 1,
	})
	require.NoError(t, err)

	second, err := repo.Create(ctx, &entity.PipelineJob{
		Status:     entity.JobStatusPending,
		Name:       "word: Graph duplicate submit",
		Language:   "en",
		Tier:       2,
		Term:       "Graph",
		TotalTerms: 1,
	})
	require.NoError(t, err)
	require.Equal(t, first.ID, second.ID)

	total, err := client.PipelineJob.Query().Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, total)
}

func TestPipelineJobRepositoryCreate_SingleWordRequiresTerm(t *testing.T) {
	repo, _ := newTestJobRepo(t)
	ctx := context.Background()

	_, err := repo.Create(ctx, &entity.PipelineJob{
		Status:     entity.JobStatusPending,
		Name:       "word: empty term",
		Language:   "en",
		Tier:       2,
		Term:       "   ",
		TotalTerms: 1,
	})
	require.ErrorIs(t, err, entity.ErrInvalidInput)
}

func TestPipelineJobRepositoryCreate_AllowsNewAfterTerminalStatus(t *testing.T) {
	repo, client := newTestJobRepo(t)
	ctx := context.Background()

	first, err := repo.Create(ctx, &entity.PipelineJob{
		Status:     entity.JobStatusCompleted,
		Name:       "word: graph completed",
		Language:   "en",
		Tier:       2,
		Term:       "graph",
		TotalTerms: 1,
	})
	require.NoError(t, err)

	second, err := repo.Create(ctx, &entity.PipelineJob{
		Status:     entity.JobStatusPending,
		Name:       "word: graph rerun",
		Language:   "en",
		Tier:       2,
		Term:       "graph",
		TotalTerms: 1,
	})
	require.NoError(t, err)
	require.NotEqual(t, first.ID, second.ID)

	total, err := client.PipelineJob.Query().Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 2, total)
}

func TestPipelineJobRepositoryClaimNextBatch_SkipsPendingIfSameTermRunning(t *testing.T) {
	repo, client := newTestJobRepo(t)
	ctx := context.Background()

	base := time.Now().Add(-time.Hour)
	runningGraph, err := client.PipelineJob.Create().
		SetStatus(string(entity.JobStatusRunning)).
		SetName("word: graph running").
		SetLanguage("en").
		SetTier(2).
		SetTerm("graph").
		SetTotalTerms(1).
		SetCreatedAt(base).
		Save(ctx)
	require.NoError(t, err)

	graphPending, err := client.PipelineJob.Create().
		SetStatus(string(entity.JobStatusPending)).
		SetName("word: graph pending").
		SetLanguage("en").
		SetTier(2).
		SetTerm("graph").
		SetTotalTerms(1).
		SetCreatedAt(base.Add(time.Second)).
		Save(ctx)
	require.NoError(t, err)

	_, err = client.PipelineJob.Create().
		SetStatus(string(entity.JobStatusPending)).
		SetName("word: wise pending").
		SetLanguage("en").
		SetTier(2).
		SetTerm("wise").
		SetTotalTerms(1).
		SetCreatedAt(base.Add(2 * time.Second)).
		Save(ctx)
	require.NoError(t, err)

	claimedBatch, err := repo.ClaimNextBatch(ctx, 1)
	require.NoError(t, err)
	require.Len(t, claimedBatch, 1)
	claimed := claimedBatch[0]
	require.NotNil(t, claimed)
	require.Equal(t, "wise", claimed.Term)
	require.Equal(t, entity.JobStatusRunning, claimed.Status)

	claimedBatch, err = repo.ClaimNextBatch(ctx, 1)
	require.NoError(t, err)
	require.Empty(t, claimedBatch)

	_, err = client.PipelineJob.UpdateOneID(runningGraph.ID).
		SetStatus(string(entity.JobStatusCompleted)).
		SetCompletedAt(time.Now()).
		Save(ctx)
	require.NoError(t, err)

	claimedBatch, err = repo.ClaimNextBatch(ctx, 1)
	require.NoError(t, err)
	require.Len(t, claimedBatch, 1)
	claimed = claimedBatch[0]
	require.NotNil(t, claimed)
	require.Equal(t, graphPending.ID, claimed.ID)
	require.Equal(t, entity.JobStatusRunning, claimed.Status)
}

package repository

import (
	"context"
	"fmt"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entdistillcache "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/distillcache"
	"github.com/eslsoft/vocnet/internal/repository"
)

type distillCacheRepository struct {
	client *entdb.Client
}

func NewDistillCacheRepository(client *entdb.Client) repository.DistillCacheRepository {
	return &distillCacheRepository{client: client}
}

func (r *distillCacheRepository) FindByHash(ctx context.Context, contextHash string) (*entity.DistillCache, error) {
	row, err := r.client.DistillCache.Query().
		Where(entdistillcache.ContextHashEQ(contextHash)).
		Only(ctx)
	if err != nil {
		return nil, translateDBError(err, "distill_cache")
	}
	return mapEntDistillCache(row), nil
}

func (r *distillCacheRepository) Create(ctx context.Context, cache *entity.DistillCache) (*entity.DistillCache, error) {
	if cache == nil {
		return nil, entity.ErrInvalidInput
	}
	row, err := r.client.DistillCache.Create().
		SetContextHash(cache.ContextHash).
		SetModel(cache.Model).
		SetPromptSummary(cache.PromptSummary).
		SetResponse(cache.Response).
		SetTokenCount(cache.TokenCount).
		Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("create distill cache: %w", err)
	}
	return mapEntDistillCache(row), nil
}

func mapEntDistillCache(row *entdb.DistillCache) *entity.DistillCache {
	if row == nil {
		return nil
	}
	return &entity.DistillCache{
		ID:            row.ID,
		ContextHash:   row.ContextHash,
		Model:         row.Model,
		PromptSummary: row.PromptSummary,
		Response:      row.Response,
		TokenCount:    row.TokenCount,
		CreatedAt:     row.CreatedAt,
	}
}

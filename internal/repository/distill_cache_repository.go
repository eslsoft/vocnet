package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// DistillCacheRepository manages cached LLM distillation responses.
type DistillCacheRepository interface {
	FindByHash(ctx context.Context, contextHash string) (*entity.DistillCache, error)
	Create(ctx context.Context, cache *entity.DistillCache) (*entity.DistillCache, error)
}

package llm

import (
	"context"
	"fmt"

	"github.com/eslsoft/vocnet/internal/entity"
)

// mockCache implements repository.DistillCacheRepository for testing.
type mockCache struct {
	stored *entity.DistillCache
}

func (m *mockCache) FindByHash(_ context.Context, contextHash string) (*entity.DistillCache, error) {
	if m.stored != nil && m.stored.ContextHash == contextHash {
		return m.stored, nil
	}
	return nil, fmt.Errorf("not found")
}

func (m *mockCache) Create(_ context.Context, cache *entity.DistillCache) (*entity.DistillCache, error) {
	m.stored = cache
	m.stored.ID = 1
	return m.stored, nil
}

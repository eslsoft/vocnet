package usecase

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

type fakeLearnedLexemeRepo struct {
	mu    sync.RWMutex
	seq   int64
	items map[int64]*entity.LearnedLexeme
}

func newFakeLearnedLexemeRepo() *fakeLearnedLexemeRepo {
	return &fakeLearnedLexemeRepo{items: make(map[int64]*entity.LearnedLexeme)}
}

func (r *fakeLearnedLexemeRepo) Create(ctx context.Context, uw *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.lookupLocked(uw.UserID, uw.Term); ok {
		return nil, entity.ErrDuplicateLearnedLexeme
	}
	r.seq++
	copy := cloneLearnedLexeme(uw)
	copy.ID = r.seq
	r.items[copy.ID] = copy
	return cloneLearnedLexeme(copy), nil
}

func (r *fakeLearnedLexemeRepo) Update(ctx context.Context, uw *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.items[uw.ID]
	if !ok || existing.UserID != uw.UserID {
		return nil, entity.ErrLearnedLexemeNotFound
	}
	if other, ok := r.lookupLocked(uw.UserID, uw.Term); ok && other.ID != uw.ID {
		return nil, entity.ErrDuplicateLearnedLexeme
	}
	copy := cloneLearnedLexeme(uw)
	r.items[copy.ID] = copy
	return cloneLearnedLexeme(copy), nil
}

func (r *fakeLearnedLexemeRepo) GetByID(ctx context.Context, userID, id int64) (*entity.LearnedLexeme, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.items[id]
	if !ok || item.UserID != userID {
		return nil, entity.ErrLearnedLexemeNotFound
	}
	return cloneLearnedLexeme(item), nil
}

func (r *fakeLearnedLexemeRepo) FindByTerm(ctx context.Context, userID int64, term string) (*entity.LearnedLexeme, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if item, ok := r.lookupLocked(userID, term); ok {
		return cloneLearnedLexeme(item), nil
	}
	return nil, nil
}

func (r *fakeLearnedLexemeRepo) List(ctx context.Context, query *repository.ListLearnedLexemeQuery) ([]entity.LearnedLexeme, int64, error) {
	if err := ctx.Err(); err != nil {
		return nil, 0, err
	}
	if query == nil {
		return nil, 0, errors.New("list query required")
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	keyword := strings.ToLower(strings.TrimSpace(extractKeyword(query.Filter)))
	var filtered []*entity.LearnedLexeme
	for _, item := range r.items {
		if item.UserID != query.UserID {
			continue
		}
		if keyword != "" {
			if !strings.Contains(strings.ToLower(item.Term), keyword) && !strings.Contains(strings.ToLower(item.Notes), keyword) {
				continue
			}
		}
		filtered = append(filtered, cloneLearnedLexeme(item))
	}

	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].CreatedAt.Equal(filtered[j].CreatedAt) {
			return filtered[i].ID < filtered[j].ID
		}
		return filtered[i].CreatedAt.After(filtered[j].CreatedAt)
	})

	total := int64(len(filtered))
	pageNo := query.PageNo
	if pageNo <= 0 {
		pageNo = 1
	}
	pageSize := query.PageSize
	if pageSize <= 0 {
		pageSize = int32(len(filtered))
	}
	start := int((pageNo - 1) * pageSize)
	if start >= len(filtered) {
		return []entity.LearnedLexeme{}, total, nil
	}
	if start < 0 {
		start = 0
	}
	end := start + int(pageSize)
	if end > len(filtered) {
		end = len(filtered)
	}
	result := make([]entity.LearnedLexeme, 0, end-start)
	for _, item := range filtered[start:end] {
		if clone := cloneLearnedLexeme(item); clone != nil {
			result = append(result, *clone)
		}
	}
	return result, total, nil
}

func (r *fakeLearnedLexemeRepo) Delete(ctx context.Context, userID, id int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.items[id]
	if !ok || item.UserID != userID {
		return entity.ErrLearnedLexemeNotFound
	}
	delete(r.items, id)
	return nil
}

func (r *fakeLearnedLexemeRepo) lookupLocked(userID int64, term string) (*entity.LearnedLexeme, bool) {
	if term == "" {
		return nil, false
	}
	needle := strings.ToLower(term)
	for _, item := range r.items {
		if item.UserID == userID && strings.ToLower(item.Term) == needle {
			return item, true
		}
	}
	return nil, false
}

func cloneLearnedLexeme(src *entity.LearnedLexeme) *entity.LearnedLexeme {
	if src == nil {
		return nil
	}
	copy := *src
	if src.Sentences != nil {
		copy.Sentences = append([]entity.Sentence(nil), src.Sentences...)
	}
	if src.Relations != nil {
		copy.Relations = append([]entity.LearnedLexemeRelation(nil), src.Relations...)
	}
	return &copy
}

type stubWordRepo struct {
	mu    sync.RWMutex
	words map[string]*entity.Word
	forms map[string][]entity.WordFormRef
}

func newStubWordRepo() *stubWordRepo {
	return &stubWordRepo{
		words: make(map[string]*entity.Word),
		forms: make(map[string][]entity.WordFormRef),
	}
}

func (r *stubWordRepo) storeWord(word *entity.Word) {
	if word == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.words[r.key(word.Language, word.Text)] = cloneWord(word)
}

func (r *stubWordRepo) storeForms(lemma string, lang entity.Language, forms []entity.WordFormRef) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := r.key(lang, lemma)
	r.forms[key] = append([]entity.WordFormRef(nil), forms...)
}

func (r *stubWordRepo) key(lang entity.Language, text string) string {
	return entity.NormalizeLanguage(lang).Code() + "|" + strings.ToLower(strings.TrimSpace(text))
}

func (r *stubWordRepo) Create(context.Context, *entity.Word) (*entity.Word, error) {
	panic("not implemented")
}

func (r *stubWordRepo) Update(context.Context, *entity.Word) (*entity.Word, error) {
	panic("not implemented")
}

func (r *stubWordRepo) GetByID(context.Context, int64) (*entity.Word, error) {
	panic("not implemented")
}

func (r *stubWordRepo) Lookup(ctx context.Context, text string, language entity.Language) (*entity.Word, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if w, ok := r.words[r.key(language, text)]; ok {
		return cloneWord(w), nil
	}
	return nil, nil
}

func (r *stubWordRepo) List(context.Context, *repository.ListWordQuery) ([]*entity.Word, int64, error) {
	panic("not implemented")
}

func (r *stubWordRepo) Delete(context.Context, int64) error {
	panic("not implemented")
}

func (r *stubWordRepo) ListFormsByLemma(ctx context.Context, lemma string, language entity.Language) ([]entity.WordFormRef, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := r.key(language, lemma)
	forms := r.forms[key]
	out := make([]entity.WordFormRef, len(forms))
	copy(out, forms)
	return out, nil
}

func cloneWord(src *entity.Word) *entity.Word {
	if src == nil {
		return nil
	}
	copy := *src
	if src.Lemma != nil {
		lemma := *src.Lemma
		copy.Lemma = &lemma
	}
	return &copy
}

func TestCollectLexemeCreatesNewEntry(t *testing.T) {
	repo := newFakeLearnedLexemeRepo()
	uc := NewLearnedLexemeUsecase(repo, nil)
	impl := uc.(*learnedLexemeUsecase)
	fixed := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	impl.clock = func() time.Time { return fixed }

	got, err := uc.CollectLexeme(context.Background(), 42, &entity.LearnedLexeme{Term: "Hello", CreatedBy: "tester"})
	if err != nil {
		t.Fatalf("CollectLexeme returned error: %v", err)
	}
	if got == nil {
		t.Fatal("CollectLexeme returned nil result")
	}
	if got.ID == 0 {
		t.Errorf("expected ID to be set, got %d", got.ID)
	}
	if got.Term != "Hello" {
		t.Errorf("expected lexeme to be 'Hello', got %q", got.Term)
	}
	if got.QueryCount != 1 {
		t.Errorf("expected query count to default to 1, got %d", got.QueryCount)
	}
	if got.Language != "en" {
		t.Errorf("expected language to default to 'en', got %q", got.Language)
	}
	if !got.CreatedAt.Equal(fixed) {
		t.Errorf("expected created_at to equal %v, got %v", fixed, got.CreatedAt)
	}
}

func TestCollectLexemeDuplicateUpdatesExisting(t *testing.T) {
	repo := newFakeLearnedLexemeRepo()
	uc := NewLearnedLexemeUsecase(repo, nil)
	impl := uc.(*learnedLexemeUsecase)
	first := time.Date(2024, 1, 2, 8, 0, 0, 0, time.UTC)
	impl.clock = func() time.Time { return first }

	_, err := uc.CollectLexeme(context.Background(), 1, &entity.LearnedLexeme{Term: "Apple"})
	if err != nil {
		t.Fatalf("CollectLexeme initial call failed: %v", err)
	}

	second := time.Date(2024, 1, 3, 9, 0, 0, 0, time.UTC)
	impl.clock = func() time.Time { return second }
	updatedMastery := entity.MasteryBreakdown{Overall: 250}
	res, err := uc.CollectLexeme(context.Background(), 1, &entity.LearnedLexeme{Term: "Apple", Notes: "updated", Mastery: updatedMastery, Language: "fr"})
	if err != nil {
		t.Fatalf("CollectLexeme duplicate failed: %v", err)
	}
	if res.QueryCount != 2 {
		t.Errorf("expected query count to increment to 2, got %d", res.QueryCount)
	}
	if res.Notes != "updated" {
		t.Errorf("expected notes to be updated, got %q", res.Notes)
	}
	if res.Mastery.Overall != 250 {
		t.Errorf("expected overall mastery 250, got %d", res.Mastery.Overall)
	}
	if res.Language != "fr" {
		t.Errorf("expected language to update to 'fr', got %q", res.Language)
	}
	if !res.UpdatedAt.Equal(second) {
		t.Errorf("expected updated_at to equal %v, got %v", second, res.UpdatedAt)
	}
}

func TestCollectLexemeAutoCollectsStandardForms(t *testing.T) {
	ctx := context.Background()
	lexRepo := newFakeLearnedLexemeRepo()
	wordRepo := newStubWordRepo()

	lemmaText := "apple"
	wordRepo.storeWord(&entity.Word{Text: lemmaText, Language: entity.LanguageEnglish, WordType: entity.WordTypeLemma})
	wordRepo.storeWord(&entity.Word{
		Text:           "apples",
		Language:       entity.LanguageEnglish,
		WordType:       "plural",
		Lemma:          &lemmaText,
		IsStandardRule: true,
	})
	wordRepo.storeWord(&entity.Word{
		Text:           "appled",
		Language:       entity.LanguageEnglish,
		WordType:       "past",
		Lemma:          &lemmaText,
		IsStandardRule: false,
	})
	wordRepo.storeForms(lemmaText, entity.LanguageEnglish, []entity.WordFormRef{
		{Text: "apples", WordType: "plural"},
		{Text: "appled", WordType: "past"},
	})

	uc := NewLearnedLexemeUsecase(lexRepo, wordRepo)
	impl := uc.(*learnedLexemeUsecase)
	fixed := time.Date(2024, 2, 1, 7, 30, 0, 0, time.UTC)
	impl.clock = func() time.Time { return fixed }

	if _, err := uc.CollectLexeme(ctx, 55, &entity.LearnedLexeme{Term: lemmaText, CreatedBy: "tester"}); err != nil {
		t.Fatalf("CollectLexeme failed: %v", err)
	}

	plural, err := lexRepo.FindByTerm(ctx, 55, "apples")
	if err != nil {
		t.Fatalf("FindByTerm returned error: %v", err)
	}
	if plural == nil {
		t.Fatalf("expected plural form to be auto-collected")
	}
	if plural.CreatedBy != "tester" {
		t.Errorf("expected CreatedBy to carry over, got %q", plural.CreatedBy)
	}
	if !plural.CreatedAt.Equal(fixed) {
		t.Errorf("expected created_at to equal %v, got %v", fixed, plural.CreatedAt)
	}

	irregular, err := lexRepo.FindByTerm(ctx, 55, "appled")
	if err != nil {
		t.Fatalf("FindByTerm irregular returned error: %v", err)
	}
	if irregular != nil {
		t.Fatalf("expected irregular form to be skipped, but got %+v", irregular)
	}
}

func TestUpdateMastery(t *testing.T) {
	repo := newFakeLearnedLexemeRepo()
	uc := NewLearnedLexemeUsecase(repo, nil)
	impl := uc.(*learnedLexemeUsecase)
	impl.clock = func() time.Time { return time.Date(2024, 1, 4, 10, 0, 0, 0, time.UTC) }

	created, err := uc.CollectLexeme(context.Background(), 9, &entity.LearnedLexeme{Term: "Bridge"})
	if err != nil {
		t.Fatalf("CollectLexeme failed: %v", err)
	}

	reviewTime := entity.ReviewTiming{IntervalDays: 2}
	impl.clock = func() time.Time { return time.Date(2024, 1, 5, 11, 0, 0, 0, time.UTC) }
	mastery := entity.MasteryBreakdown{Listen: 2, Read: 3, Overall: 180}
	updated, err := uc.UpdateMastery(context.Background(), 9, created.ID, mastery, reviewTime, "keep going")
	if err != nil {
		t.Fatalf("UpdateMastery failed: %v", err)
	}
	if updated.Mastery != mastery {
		t.Errorf("expected mastery %+v, got %+v", mastery, updated.Mastery)
	}
	if updated.Review.IntervalDays != 2 {
		t.Errorf("expected interval days 2, got %d", updated.Review.IntervalDays)
	}
	if updated.Notes != "keep going" {
		t.Errorf("expected notes to be 'keep going', got %q", updated.Notes)
	}
}

func TestListLearnedLexemesFiltersByKeyword(t *testing.T) {
	repo := newFakeLearnedLexemeRepo()
	uc := NewLearnedLexemeUsecase(repo, nil)
	impl := uc.(*learnedLexemeUsecase)
	impl.clock = time.Now

	_, _ = uc.CollectLexeme(context.Background(), 5, &entity.LearnedLexeme{Term: "Comet", Notes: "space"})
	_, _ = uc.CollectLexeme(context.Background(), 5, &entity.LearnedLexeme{Term: "Forest", Notes: "trees"})

	query := &repository.ListLearnedLexemeQuery{
		Pagination:  repository.Pagination{PageNo: 1, PageSize: 10},
		FilterOrder: repository.FilterOrder{Filter: "keyword == \"tre\""},
		UserID:      5,
	}
	items, total, err := uc.ListLearnedLexemes(context.Background(), query)
	if err != nil {
		t.Fatalf("ListLearnedLexemes returned error: %v", err)
	}
	if total != 1 {
		t.Fatalf("expected total 1, got %d", total)
	}
	if len(items) != 1 || items[0].Term != "Forest" {
		t.Fatalf("expected to retrieve Forest entry, got %+v", items)
	}
}

func extractKeyword(filter string) string {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return ""
	}
	for _, quote := range []string{"\"", "'"} {
		s := strings.Split(filter, quote)
		if len(s) >= 3 {
			return s[1]
		}
	}
	return strings.Trim(filter, "\"'")
}

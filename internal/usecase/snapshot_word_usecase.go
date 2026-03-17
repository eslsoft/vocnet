package usecase

import (
	"context"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=snapshot_word_usecase.go -destination=../mocks/mock_word_usecase.go -package=mocks

// WordUsecase exposes read-only word lookup and list queries.
type WordUsecase interface {
	// Query operations (read-only, write operations removed per user request)
	GetLemma(ctx context.Context, lemmaID int64) (*entity.WordEntry, error)
	Lookup(ctx context.Context, surface string, language entity.Language) (*entity.WordEntry, error)
	List(ctx context.Context, filter *repository.ListWordsQuery) ([]*entity.WordEntry, int64, error)
	ListCategories(ctx context.Context, search string) ([]string, error)
	Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error)
}

type snapshotWordUsecase struct {
	snapshots repository.LemmaSnapshotRepository
}

// NewSnapshotWordUsecase creates a WordUsecase that uses LemmaSnapshot as the data source.
func NewSnapshotWordUsecase(snapshots repository.LemmaSnapshotRepository) WordUsecase {
	return &snapshotWordUsecase{snapshots: snapshots}
}

func (u *snapshotWordUsecase) GetLemma(ctx context.Context, lemmaID int64) (*entity.WordEntry, error) {
	if lemmaID == 0 {
		return nil, entity.ErrInvalidInput
	}
	snapshot, err := u.snapshots.GetByLemma(ctx, lemmaID)
	if err != nil {
		return nil, err
	}
	return snapshotToWordEntry(snapshot, snapshot.Surface), nil
}

func (u *snapshotWordUsecase) Lookup(ctx context.Context, surface string, language entity.Language) (*entity.WordEntry, error) {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return nil, entity.ErrInvalidLexemeText
	}

	snapshot, err := u.snapshots.GetByTerm(ctx, surface, string(language))
	if err != nil {
		return nil, err
	}
	return snapshotToWordEntry(snapshot, surface), nil
}

// pickBestLemma selects the best lemma for a given search surface.
// Priority: prefix match (shortest base form) > exact match > most forms.
// This ensures "living" → "live", "cheaply" → "cheap", "does" → "do".
func (u *snapshotWordUsecase) List(ctx context.Context, query *repository.ListWordsQuery) ([]*entity.WordEntry, int64, error) {
	// Handle surface term lookup
	if surfaceTerms := query.SurfaceTerms; len(surfaceTerms) > 0 {
		entries := make([]*entity.WordEntry, 0, len(surfaceTerms))
		seen := make(map[int64]struct{})
		for _, term := range surfaceTerms {
			snapshot, err := u.snapshots.GetByTerm(ctx, term, query.Language)
			if err != nil {
				continue
			}
			if snapshot == nil {
				continue
			}
			if _, ok := seen[snapshot.LemmaID]; ok {
				continue
			}
			entry := snapshotToWordEntry(snapshot, term)
			if entry == nil {
				continue
			}
			entries = append(entries, entry)
			seen[snapshot.LemmaID] = struct{}{}
		}
		return entries, int64(len(entries)), nil
	}

	// Convert ListWordsQuery to ListLatestLemmaSnapshotsQuery
	snapshotQuery := &repository.ListLatestLemmaSnapshotsQuery{
		PageNo:     query.PageNo,
		PageSize:   query.PageSize,
		Keyword:    query.Keyword,
		Categories: query.Categories,
		Levels:     query.Levels,
		POS:        query.POS,
		MinQScore:  query.MinQScore,
		SortBy:     query.PrimaryKey,
		SortDesc:   query.PrimaryDesc,
	}

	snapshots, total, err := u.snapshots.ListLatest(ctx, snapshotQuery)
	if err != nil {
		return nil, 0, err
	}

	entries := make([]*entity.WordEntry, 0, len(snapshots))
	for _, snapshot := range snapshots {
		entry := snapshotToWordEntry(snapshot, snapshot.Surface)
		if entry != nil {
			entries = append(entries, entry)
		}
	}
	return entries, total, nil
}

func (u *snapshotWordUsecase) ListCategories(ctx context.Context, search string) ([]string, error) {
	// Aggregate categories from snapshots
	query := &repository.ListLatestLemmaSnapshotsQuery{
		PageNo:   1,
		PageSize: 10000, // Get all to aggregate categories
	}

	snapshots, _, err := u.snapshots.ListLatest(ctx, query)
	if err != nil {
		return nil, err
	}

	categorySet := make(map[string]struct{})
	searchLower := strings.ToLower(search)

	for _, snapshot := range snapshots {
		for _, cat := range snapshot.Payload.Categories {
			if search == "" || strings.Contains(strings.ToLower(cat), searchLower) {
				categorySet[cat] = struct{}{}
			}
		}
	}

	categories := make([]string, 0, len(categorySet))
	for cat := range categorySet {
		categories = append(categories, cat)
	}

	return categories, nil
}

func (u *snapshotWordUsecase) Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error) {
	// Build query from filter
	query := &repository.ListLatestLemmaSnapshotsQuery{
		PageNo:   1,
		PageSize: 10000, // Get all for stats calculation
	}

	// TODO: Add language filter support in ListLatestLemmaSnapshotsQuery when needed
	_ = filter // Currently unused, but kept for interface compatibility

	snapshots, total, err := u.snapshots.ListLatest(ctx, query)
	if err != nil {
		return nil, err
	}

	// Calculate statistics from snapshots
	stats := &entity.WordStats{
		Summary: entity.WordStatsSummary{
			TotalWords:     total,
			TotalLexemes:   0,
			TotalForms:     0,
			TotalRelations: 0,
		},
		Coverage: entity.WordCoverage{
			Phonetics:   0,
			Categories:  0,
			Definitions: 0,
			Forms:       0,
		},
	}

	if len(snapshots) == 0 {
		return stats, nil
	}

	var qScoreSum float64
	var hasPhonetics, hasCategories, hasDefinitions, hasForms int

	for _, snapshot := range snapshots {
		stats.Summary.TotalLexemes += int64(snapshot.LexemeCount)
		stats.Summary.TotalForms += int64(snapshot.FormCount)
		stats.Summary.TotalRelations += int64(snapshot.RelationCount)
		qScoreSum += snapshot.Quality.Overall

		// Check coverage
		if hasSnapshotPhonetics(snapshot) {
			hasPhonetics++
		}
		if len(snapshot.Payload.Categories) > 0 {
			hasCategories++
		}
		if snapshot.LexemeCount > 0 {
			hasDefinitions++
		}
		if len(snapshot.Payload.Forms) > 0 {
			hasForms++
		}
	}

	stats.Summary.AvgQScore = qScoreSum / float64(len(snapshots))
	stats.Coverage.Phonetics = float64(hasPhonetics) / float64(len(snapshots))
	stats.Coverage.Categories = float64(hasCategories) / float64(len(snapshots))
	stats.Coverage.Definitions = float64(hasDefinitions) / float64(len(snapshots))
	stats.Coverage.Forms = float64(hasForms) / float64(len(snapshots))

	return stats, nil
}

// snapshotToWordEntry converts a LemmaSnapshot to WordEntry for backward compatibility.
func snapshotToWordEntry(snapshot *entity.LemmaSnapshot, queriedTerm string) *entity.WordEntry {
	if snapshot == nil {
		return nil
	}

	// Create a minimal Lemma from snapshot for backward compatibility
	lemma := &entity.Lemma{
		ID:         snapshot.LemmaID,
		Surface:    snapshot.Surface,
		Normalized: snapshot.Normalized,
		Level:      snapshot.Level,
		Syllables:  snapshot.Payload.Syllables,
	}

	// Convert snapshot forms to LemmaForms
	forms := make([]*entity.LemmaForm, 0, len(snapshot.Payload.Forms))
	for _, sf := range snapshot.Payload.Forms {
		form := &entity.LemmaForm{
			LemmaID:     snapshot.LemmaID,
			Surface:     sf.Surface,
			Normalized:  strings.ToLower(sf.Surface),
			FormType:    parseFormType(sf.FormType),
			IsIrregular: sf.IsIrregular,
			Phonetics:   sf.Phonetics,
			Syllables:   sf.Syllables,
		}
		forms = append(forms, form)
	}
	lemma.Forms = forms

	// Convert snapshot lexemes to entity.Lexeme
	lexemes := make([]entity.Lexeme, 0, len(snapshot.Payload.Lexemes))
	for _, sl := range snapshot.Payload.Lexemes {
		lex := entity.Lexeme{
			ExternalID:   sl.ExternalID,
			Language:     entity.ParseLanguage(sl.Language),
			PartOfSpeech: entity.PartOfSpeech(sl.POS),
			Categories:   snapshot.Payload.Categories,
		}

		// Convert senses
		senses := make([]entity.LexemeSense, 0, len(sl.Senses))
		for _, sense := range sl.Senses {
			examples := make([]entity.SenseExample, 0, len(sense.Examples))
			for _, ex := range sense.Examples {
				examples = append(examples, entity.SenseExample{Text: ex})
			}
			senses = append(senses, entity.LexemeSense{
				Language: entity.ParseLanguage(sense.Language),
				Gloss:    sense.Gloss,
				Examples: examples,
			})
		}
		lex.Senses = senses

		lexemes = append(lexemes, lex)
	}

	return &entity.WordEntry{
		QueriedTerm: queriedTerm,
		Lemma:       lemma,
		Lexemies:    lexemes,
		Relations:   snapshot.Payload.Relations,
	}
}

func parseFormType(s string) entity.FormType {
	switch strings.ToUpper(s) {
	case "LEMMA":
		return entity.FormTypeLemma
	case "PLURAL":
		return entity.FormTypePlural
	case "PAST":
		return entity.FormTypePast
	case "PAST_PARTICIPLE":
		return entity.FormTypePastParticiple
	case "PRESENT_PARTICIPLE":
		return entity.FormTypePresentParticiple
	case "THIRD_PERSON_SINGULAR":
		return entity.FormTypeThirdPersonSingular
	case "COMPARATIVE":
		return entity.FormTypeComparative
	case "SUPERLATIVE":
		return entity.FormTypeSuperlative
	case "IMPERATIVE":
		return entity.FormTypeImperative
	case "SUBJUNCTIVE":
		return entity.FormTypeSubjunctive
	case "GERUND":
		return entity.FormTypeGerund
	case "SHORT_FORM":
		return entity.FormTypeShortForm
	default:
		return entity.FormTypeUnspecified
	}
}

func hasSnapshotPhonetics(snapshot *entity.LemmaSnapshot) bool {
	for _, form := range snapshot.Payload.Forms {
		if len(form.Phonetics) > 0 {
			return true
		}
	}
	return false
}

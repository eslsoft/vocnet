package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Persistence handles all database operations at stage boundaries.
type Persistence struct {
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	evidenceRepo repository.EvidenceRepository
	relationRepo repository.SemanticRelationRepository
	snapshotRepo repository.WordSnapshotRepository
	aggregator   *DataAggregator
	logger       *slog.Logger
}

// NewPersistence creates a new Persistence service.
func NewPersistence(
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	evidenceRepo repository.EvidenceRepository,
	relationRepo repository.SemanticRelationRepository,
	snapshotRepo repository.WordSnapshotRepository,
	aggregator *DataAggregator,
	logger *slog.Logger,
) *Persistence {
	return &Persistence{
		lemmaRepo:    lemmaRepo,
		lexemeRepo:   lexemeRepo,
		evidenceRepo: evidenceRepo,
		relationRepo: relationRepo,
		snapshotRepo: snapshotRepo,
		aggregator:   aggregator,
		logger:       logger,
	}
}

// SaveStageResult persists the accumulated result of a pipeline stage.
// Order: evidence → forms → lexemes (create or update) → relations.
func (p *Persistence) SaveStageResult(ctx context.Context, lemma *entity.Lemma, result *ProcessResult) error {
	if result == nil {
		return nil
	}

	// Save evidence
	for _, ev := range result.Evidence {
		ev.LemmaID = lemma.ID
		if _, err := p.evidenceRepo.Create(ctx, ev); err != nil {
			return fmt.Errorf("save evidence: %w", err)
		}
	}

	// Save forms (create new, merge existing)
	if err := p.saveForms(ctx, lemma.ID, result); err != nil {
		return fmt.Errorf("save forms: %w", err)
	}

	// Save or update lexemes
	if err := p.saveOrUpdateLexemes(ctx, lemma.ID, result.Lexemes); err != nil {
		return fmt.Errorf("save lexemes: %w", err)
	}

	// Save relations (resolve ExternalID → DB SourceLexemeID first)
	if len(result.Relations) > 0 {
		if err := p.resolveRelationIDs(ctx, result.Relations); err != nil {
			return fmt.Errorf("resolve relation IDs: %w", err)
		}
		relations := deduplicateRelations(result.Relations)
		relations, err := p.filterExistingUniqueRelations(ctx, relations)
		if err != nil {
			return fmt.Errorf("filter existing relations: %w", err)
		}
		if _, err := p.relationRepo.BatchCreate(ctx, relations); err != nil {
			return fmt.Errorf("save relations: %w", err)
		}
	}

	return nil
}

// SaveSnapshot persists a new snapshot version for a lemma.
func (p *Persistence) SaveSnapshot(ctx context.Context, jobID int64, lemma *entity.Lemma, forms []*entity.LemmaForm, snapshot *entity.WordSnapshot) error {
	if lemma == nil {
		return fmt.Errorf("lemma is required")
	}
	terms := collectSnapshotTerms(lemma, forms)
	snapshot.LemmaID = lemma.ID
	snapshot.JobID = &jobID
	snapshot.Terms = terms
	snapshot.Latest = true
	_, err := p.snapshotRepo.CreateOrUpdate(ctx, snapshot)
	if err != nil {
		return fmt.Errorf("save snapshot: %w", err)
	}
	return nil
}

func collectSnapshotTerms(lemma *entity.Lemma, forms []*entity.LemmaForm) []string {
	seen := make(map[string]struct{})
	terms := make([]string, 0, 1+len(forms))

	appendTerm := func(v string) {
		v = strings.ToLower(strings.TrimSpace(v))
		if v == "" {
			return
		}
		if _, ok := seen[v]; ok {
			return
		}
		seen[v] = struct{}{}
		terms = append(terms, v)
	}

	if lemma != nil {
		appendTerm(lemma.Surface)
	}
	for _, f := range forms {
		if f == nil {
			continue
		}
		appendTerm(f.Surface)
	}
	return terms
}

// collectUniqueForms deduplicates forms from the process result.
func collectUniqueForms(result *ProcessResult) []*entity.LemmaForm {
	if len(result.FormsByLexeme) == 0 {
		return result.Forms
	}

	var allForms []*entity.LemmaForm
	seen := make(map[string]bool)
	for _, forms := range result.FormsByLexeme {
		for _, form := range forms {
			key := formKey(form)
			if !seen[key] {
				allForms = append(allForms, form)
				seen[key] = true
			}
		}
	}
	return allForms
}

func formKey(f *entity.LemmaForm) string {
	return f.Surface + ":" + string(f.FormType)
}

// mergeExistingForm updates phonetics and syllables of an existing form.
func (p *Persistence) mergeExistingForm(ctx context.Context, lemmaID int64, existing, newForm *entity.LemmaForm) {
	if len(newForm.Phonetics) > 0 {
		merged := p.aggregator.MergePhonetics(existing.Phonetics, newForm.Phonetics)
		if len(merged) > len(existing.Phonetics) {
			if err := p.lemmaRepo.UpdateFormPhonetics(ctx, lemmaID, newForm.FormType, merged); err != nil {
				p.logger.Warn("failed to update form phonetics",
					"surface", newForm.Surface, "error", err)
			}
		}
	}
	if len(newForm.Syllables) > 0 {
		if err := p.lemmaRepo.UpdateFormSyllables(ctx, lemmaID, newForm.FormType, newForm.Syllables); err != nil {
			p.logger.Warn("failed to update form syllables",
				"surface", newForm.Surface, "error", err)
		}
	}
}

// saveForms persists or updates lemma forms from a stage result.
func (p *Persistence) saveForms(ctx context.Context, lemmaID int64, result *ProcessResult) error {
	allForms := collectUniqueForms(result)
	if len(allForms) == 0 {
		return nil
	}

	existingLemma, err := p.lemmaRepo.GetByID(ctx, lemmaID)
	if err != nil {
		return fmt.Errorf("get lemma: %w", err)
	}

	existingMap := make(map[string]*entity.LemmaForm)
	for _, f := range existingLemma.Forms {
		existingMap[formKey(f)] = f
	}

	var formsToCreate []entity.LemmaForm
	for _, newForm := range allForms {
		newForm.LemmaID = lemmaID
		if existing, ok := existingMap[formKey(newForm)]; ok {
			p.mergeExistingForm(ctx, lemmaID, existing, newForm)
		} else {
			formsToCreate = append(formsToCreate, *newForm)
		}
	}

	if len(formsToCreate) > 0 {
		if err := p.lemmaRepo.CreateForms(ctx, lemmaID, formsToCreate); err != nil {
			return fmt.Errorf("create forms: %w", err)
		}
	}

	return nil
}

// updateLexeme enriches and persists an existing lexeme, returning the enriched result.
func (p *Persistence) updateLexeme(ctx context.Context, existing, newLex *entity.Lexeme) (*entity.Lexeme, error) {
	enriched := p.aggregator.EnrichLexeme(existing, newLex)
	if _, err := p.lexemeRepo.Update(ctx, enriched); err != nil {
		return nil, fmt.Errorf("update lexeme %s: %w", newLex.ExternalID, err)
	}
	p.logger.Info("lexeme updated", "lexeme_id", enriched.ID, "external_id", enriched.ExternalID)
	return enriched, nil
}

// findExistingLexeme looks up a lexeme by ExternalID in the local cache, then in the DB.
func (p *Persistence) findExistingLexeme(ctx context.Context, extID string, cache map[string]*entity.Lexeme) *entity.Lexeme {
	if ex, ok := cache[extID]; ok {
		return ex
	}
	if dbLex, err := p.lexemeRepo.GetByExternalID(ctx, extID); err == nil {
		return dbLex
	}
	return nil
}

// saveOrUpdateLexemes creates new lexemes or updates existing ones.
func (p *Persistence) saveOrUpdateLexemes(ctx context.Context, lemmaID int64, lexemes []*entity.Lexeme) error {
	if len(lexemes) == 0 {
		return nil
	}

	existing, err := p.lexemeRepo.ListByLemmaID(ctx, lemmaID)
	if err != nil {
		p.logger.Warn("failed to list existing lexemes", "lemma_id", lemmaID, "error", err)
		existing = nil
	}

	existingByExtID := make(map[string]*entity.Lexeme)
	for _, lex := range existing {
		if lex.ExternalID != "" {
			existingByExtID[lex.ExternalID] = lex
		}
	}

	for _, newLex := range lexemes {
		newLex.LemmaID = lemmaID

		if newLex.ExternalID != "" {
			if found := p.findExistingLexeme(ctx, newLex.ExternalID, existingByExtID); found != nil {
				enriched, err := p.updateLexeme(ctx, found, newLex)
				if err != nil {
					return err
				}
				existingByExtID[newLex.ExternalID] = enriched
				continue
			}
		}

		if len(existing) > 0 && newLex.ExternalID == "" {
			if _, err := p.updateLexeme(ctx, existing[0], newLex); err != nil {
				return err
			}
		} else if newLex.ID == 0 {
			created, err := p.lexemeRepo.Create(ctx, newLex)
			if err != nil {
				return fmt.Errorf("create lexeme %s: %w", newLex.ExternalID, err)
			}
			existingByExtID[created.ExternalID] = created
			p.logger.Info("lexeme created", "lexeme_id", created.ID, "external_id", created.ExternalID)
		}
	}

	return nil
}

// resolveRelationIDs resolves SourceExternalID → DB SourceLexemeID for all relations.
func (p *Persistence) resolveRelationIDs(ctx context.Context, relations []*entity.SemanticRelation) error {
	sourceLexemeByExternalID := p.loadRelationLexemeIndex(ctx, relations)
	targetLookup := p.loadRelationTargetLookup(ctx, relations, sourceLexemeByExternalID)
	for _, rel := range relations {
		srcLex := sourceLexemeByExternalID[rel.SourceExternalID]
		if srcLex == nil {
			continue
		}
		rel.SourceLexemeID = srcLex.ID

		p.resolveRelationTarget(rel, srcLex, sourceLexemeByExternalID, targetLookup)
	}
	return nil
}

func collectExternalIDsForRelations(relations []*entity.SemanticRelation) map[string]bool {
	extIDs := make(map[string]bool)
	for _, rel := range relations {
		if rel == nil {
			continue
		}
		if rel.SourceExternalID != "" {
			extIDs[rel.SourceExternalID] = true
		}
		if ext := parseWikidataLexemeRef(rel.TargetRef); ext != "" {
			extIDs[ext] = true
		}
	}
	return extIDs
}

func (p *Persistence) loadRelationLexemeIndex(ctx context.Context, relations []*entity.SemanticRelation) map[string]*entity.Lexeme {
	extIDs := collectExternalIDsForRelations(relations)
	sourceLexemeByExternalID := make(map[string]*entity.Lexeme, len(extIDs))
	for extID := range extIDs {
		lex, err := p.lexemeRepo.GetByExternalID(ctx, extID)
		if err != nil {
			p.logger.Warn("could not resolve lexeme ExternalID", "external_id", extID, "error", err)
			continue
		}
		sourceLexemeByExternalID[extID] = lex
	}
	return sourceLexemeByExternalID
}

func collectTargetTermsByLanguage(relations []*entity.SemanticRelation, sourceLexemeByExternalID map[string]*entity.Lexeme) map[entity.Language]map[string]struct{} {
	targetTermsByLang := make(map[entity.Language]map[string]struct{})
	for _, rel := range relations {
		if rel == nil {
			continue
		}
		srcLex := sourceLexemeByExternalID[rel.SourceExternalID]
		if srcLex == nil {
			continue
		}
		if rel.TargetLexemeID != nil || strings.TrimSpace(rel.TargetTerm) == "" {
			continue
		}
		lang := srcLex.Language
		if targetTermsByLang[lang] == nil {
			targetTermsByLang[lang] = make(map[string]struct{})
		}
		for _, candidate := range relationTargetLookupTerms(rel.TargetTerm) {
			targetTermsByLang[lang][candidate] = struct{}{}
		}
	}
	return targetTermsByLang
}

func (p *Persistence) loadRelationTargetLookup(ctx context.Context, relations []*entity.SemanticRelation, sourceLexemeByExternalID map[string]*entity.Lexeme) map[entity.Language]map[string][]*repository.LexemeFormInfo {
	targetTermsByLang := collectTargetTermsByLanguage(relations, sourceLexemeByExternalID)
	targetLookup := make(map[entity.Language]map[string][]*repository.LexemeFormInfo, len(targetTermsByLang))
	for lang, termSet := range targetTermsByLang {
		terms := make([]string, 0, len(termSet))
		for term := range termSet {
			terms = append(terms, term)
		}
		info, err := p.lexemeRepo.BatchLookupFormInfo(ctx, terms, lang)
		if err != nil {
			p.logger.Warn("failed to batch resolve relation targets", "language", lang, "error", err)
			continue
		}
		targetLookup[lang] = info
	}
	return targetLookup
}

func (p *Persistence) resolveRelationTarget(
	rel *entity.SemanticRelation,
	srcLex *entity.Lexeme,
	sourceLexemeByExternalID map[string]*entity.Lexeme,
	targetLookup map[entity.Language]map[string][]*repository.LexemeFormInfo,
) {
	if rel.TargetLexemeID != nil {
		if strings.TrimSpace(rel.TargetRef) == "" {
			rel.TargetRef = internalLexemeRef(*rel.TargetLexemeID)
		}
		return
	}

	if ext := parseWikidataLexemeRef(rel.TargetRef); ext != "" {
		targetLex := sourceLexemeByExternalID[ext]
		if targetLex != nil && targetLex.ID != srcLex.ID {
			id := targetLex.ID
			rel.TargetLexemeID = &id
			return
		}
	}

	candidatesByTerm := targetLookup[srcLex.Language]
	if candidatesByTerm == nil {
		return
	}
	for _, lookupTerm := range relationTargetLookupTerms(rel.TargetTerm) {
		candidates := candidatesByTerm[lookupTerm]
		targetID := chooseTargetLexemeID(srcLex, candidates)
		if targetID != nil {
			rel.TargetLexemeID = targetID
			if strings.TrimSpace(rel.TargetRef) == "" {
				rel.TargetRef = internalLexemeRef(*targetID)
			}
			break
		}
	}
}

func relationTargetLookupTerms(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	candidates := make([]string, 0, 4)
	seen := map[string]struct{}{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		candidates = append(candidates, s)
	}

	add(trimmed)
	add(strings.ReplaceAll(trimmed, "_", " "))

	if strings.HasPrefix(trimmed, "synset:") {
		if open := strings.Index(trimmed, "("); open >= 0 {
			if close := strings.LastIndex(trimmed, ")"); close > open+1 {
				add(trimmed[open+1 : close])
			}
		}
	}

	return candidates
}

func deduplicateRelations(relations []*entity.SemanticRelation) []*entity.SemanticRelation {
	if len(relations) <= 1 {
		return relations
	}

	merged := make(map[string]*entity.SemanticRelation, len(relations))
	for _, rel := range relations {
		if rel == nil {
			continue
		}
		targetID := "nil"
		if rel.TargetLexemeID != nil {
			targetID = fmt.Sprintf("%d", *rel.TargetLexemeID)
		}
		// Keep consistent with DB uniqueness while avoiding over-collapse:
		// - Resolved edge: unique by (source_lexeme_id, target_lexeme_id, relation_type)
		// - Unresolved edge: keep target_term dimension to preserve distinct textual neighbors.
		key := fmt.Sprintf("%d|%s|%s",
			rel.SourceLexemeID,
			targetID,
			rel.RelationType,
		)
		if rel.TargetLexemeID == nil {
			key += "|" + strings.ToLower(strings.TrimSpace(rel.TargetRef))
			key += "|" + strings.ToLower(strings.TrimSpace(rel.TargetTerm))
		}
		existing, ok := merged[key]
		if !ok {
			merged[key] = rel
			continue
		}

		if rel.Strength > existing.Strength {
			existing.Strength = rel.Strength
		}
		existing.SenseMapped = existing.SenseMapped || rel.SenseMapped
		if existing.TargetLexemeID == nil && rel.TargetLexemeID != nil {
			existing.TargetLexemeID = rel.TargetLexemeID
		}
		if strings.TrimSpace(existing.TargetRef) == "" && strings.TrimSpace(rel.TargetRef) != "" {
			existing.TargetRef = rel.TargetRef
		}
		// Keep higher-trust provider for merged edge.
		if providerTrustRank(rel.Provider) > providerTrustRank(existing.Provider) {
			existing.Provider = rel.Provider
		}
		// Keep a stable, non-empty display term.
		if strings.TrimSpace(existing.TargetTerm) == "" && strings.TrimSpace(rel.TargetTerm) != "" {
			existing.TargetTerm = rel.TargetTerm
		}
	}

	out := make([]*entity.SemanticRelation, 0, len(merged))
	for _, rel := range merged {
		out = append(out, rel)
	}
	return out
}

func providerTrustRank(provider string) int {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "wordnet":
		return 4
	case "llm":
		return 3
	case "ecdict":
		return 2
	case "conceptnet":
		return 1
	default:
		return 0
	}
}

func chooseTargetLexemeID(source *entity.Lexeme, candidates []*repository.LexemeFormInfo) *int64 {
	if source == nil || len(candidates) == 0 {
		return nil
	}

	sourcePOS := source.PartOfSpeech
	for _, c := range candidates {
		if c == nil || c.LexemeID == 0 || c.LexemeID == source.ID {
			continue
		}
		if sourcePOS != entity.PartOfSpeechUnspecified && strings.ToLower(strings.TrimSpace(c.Pos)) == string(sourcePOS) {
			id := c.LexemeID
			return &id
		}
	}

	for _, c := range candidates {
		if c == nil || c.LexemeID == 0 || c.LexemeID == source.ID {
			continue
		}
		id := c.LexemeID
		return &id
	}

	return nil
}

func (p *Persistence) filterExistingUniqueRelations(ctx context.Context, relations []*entity.SemanticRelation) ([]*entity.SemanticRelation, error) {
	if len(relations) == 0 {
		return relations, nil
	}

	sourceIDs := make(map[int64]struct{})
	for _, rel := range relations {
		if rel == nil || rel.SourceLexemeID == 0 || rel.TargetLexemeID == nil {
			continue
		}
		sourceIDs[rel.SourceLexemeID] = struct{}{}
	}
	if len(sourceIDs) == 0 {
		return relations, nil
	}

	existingKeys := make(map[string]struct{})
	for sourceID := range sourceIDs {
		existing, err := p.relationRepo.FindBySourceLexeme(ctx, sourceID)
		if err != nil {
			return nil, err
		}
		for _, rel := range existing {
			key, ok := relationUniqueKey(rel)
			if !ok {
				continue
			}
			existingKeys[key] = struct{}{}
		}
	}

	out := make([]*entity.SemanticRelation, 0, len(relations))
	for _, rel := range relations {
		key, ok := relationUniqueKey(rel)
		if ok {
			if _, exists := existingKeys[key]; exists {
				continue
			}
			existingKeys[key] = struct{}{}
		}
		out = append(out, rel)
	}
	return out, nil
}

func relationUniqueKey(rel *entity.SemanticRelation) (string, bool) {
	if rel == nil || rel.TargetLexemeID == nil || rel.SourceLexemeID == 0 {
		return "", false
	}
	return fmt.Sprintf("%d|%d|%s", rel.SourceLexemeID, *rel.TargetLexemeID, rel.RelationType), true
}

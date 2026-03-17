package persist

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
)

// Persistence handles all database operations at stage boundaries.
type Persistence struct {
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	evidenceRepo repository.EvidenceRepository
	relationRepo repository.SemanticRelationRepository
	snapshotRepo repository.LemmaSnapshotRepository
	logger       *slog.Logger

	lemmaSurfacesMu    sync.Mutex
	lemmaSurfacesCache map[string]struct{}
}

// NewPersistence creates a new Persistence service.
func NewPersistence(
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	evidenceRepo repository.EvidenceRepository,
	relationRepo repository.SemanticRelationRepository,
	snapshotRepo repository.LemmaSnapshotRepository,
	logger *slog.Logger,
) *Persistence {
	return &Persistence{
		lemmaRepo:    lemmaRepo,
		lexemeRepo:   lexemeRepo,
		evidenceRepo: evidenceRepo,
		relationRepo: relationRepo,
		snapshotRepo: snapshotRepo,
		logger:       logger,
	}
}

// SaveEvidence persists raw source evidence. Called by the engine after Collection.
func (p *Persistence) SaveEvidence(ctx context.Context, lemma *entity.Lemma, evidence []*entity.RawEvidence) error {
	for _, ev := range evidence {
		ev.LemmaID = lemma.ID
		if _, err := p.evidenceRepo.Create(ctx, ev); err != nil {
			return fmt.Errorf("save evidence: %w", err)
		}
	}
	return nil
}

// SaveIntegrationResult replaces all forms, lexemes, and relations for a lemma.
// Uses delete-then-create to ensure idempotent, order-independent results.
func (p *Persistence) SaveIntegrationResult(ctx context.Context, lemma *entity.Lemma, result *scoring.ProcessResult) error {
	if result == nil {
		return nil
	}

	// 1. Delete existing data (order: relations → lexemes → forms)
	if err := p.relationRepo.DeleteByLemmaID(ctx, lemma.ID); err != nil {
		return fmt.Errorf("delete relations: %w", err)
	}
	if err := p.lexemeRepo.DeleteByLemmaID(ctx, lemma.ID); err != nil {
		return fmt.Errorf("delete lexemes: %w", err)
	}
	if err := p.lemmaRepo.DeleteAllForms(ctx, lemma.ID); err != nil {
		return fmt.Errorf("delete forms: %w", err)
	}

	// 2. Create forms
	allForms := collectUniqueForms(result)
	if len(allForms) > 0 {
		formsToCreate := make([]entity.LemmaForm, 0, len(allForms))
		for _, f := range allForms {
			f.LemmaID = lemma.ID
			formsToCreate = append(formsToCreate, *f)
		}
		if err := p.lemmaRepo.CreateForms(ctx, lemma.ID, formsToCreate); err != nil {
			return fmt.Errorf("create forms: %w", err)
		}
	}

	// 3. Create lexemes
	for _, lex := range result.Lexemes {
		lex.LemmaID = lemma.ID
		if lex.ExternalID == "" {
			continue
		}
		if _, err := p.lexemeRepo.Create(ctx, lex); err != nil {
			return fmt.Errorf("create lexeme %s: %w", lex.ExternalID, err)
		}
	}

	// 4. Create relations (resolve ExternalID → DB SourceLexemeID first)
	if len(result.Relations) > 0 {
		p.mapUnmappedContribRelations(result.Relations, result.Lexemes)
		if err := p.resolveRelationIDs(ctx, result.Relations); err != nil {
			return fmt.Errorf("resolve relation IDs: %w", err)
		}
		relations := deduplicateRelations(result.Relations)

		// Collect newly created lexeme IDs for FK validation.
		createdLexemeIDs := make(map[int64]struct{})
		if dbLexemes, err := p.lexemeRepo.ListByLemmaID(ctx, lemma.ID); err == nil {
			for _, lex := range dbLexemes {
				createdLexemeIDs[lex.ID] = struct{}{}
			}
		}

		validRelations := make([]*entity.SemanticRelation, 0, len(relations))
		for _, rel := range relations {
			if rel.SourceLexemeID == 0 {
				continue
			}
			// Ensure both source and target lexemes exist.
			if _, ok := createdLexemeIDs[rel.SourceLexemeID]; !ok {
				continue
			}
			if rel.TargetLexemeID != nil {
				if _, ok := createdLexemeIDs[*rel.TargetLexemeID]; !ok {
					rel.TargetLexemeID = nil // unresolved target
				}
			}
			validRelations = append(validRelations, rel)
		}
		if len(validRelations) > 0 {
			if _, err := p.relationRepo.BatchCreate(ctx, validRelations); err != nil {
				return fmt.Errorf("save relations: %w", err)
			}
		}
	}

	return nil
}

// SaveLemmaSnapshot persists a new snapshot version for a lemma.
func (p *Persistence) SaveLemmaSnapshot(ctx context.Context, jobID int64, lemma *entity.Lemma, forms []*entity.LemmaForm, snapshot *entity.LemmaSnapshot) error {
	if lemma == nil {
		return fmt.Errorf("lemma is required")
	}

	// Update the lemma entity with any changes (e.g., CEFR level from integration)
	_, err := p.lemmaRepo.Update(ctx, lemma)
	if err != nil {
		return fmt.Errorf("update lemma: %w", err)
	}

	// Load all lemma surfaces for form ownership check.
	allLemmaSurfaces := p.loadAllLemmaSurfaces(ctx)
	terms := collectLemmaSnapshotLookupTerms(lemma, forms, allLemmaSurfaces)
	snapshot.LemmaID = lemma.ID
	snapshot.JobID = &jobID
	snapshot.LookupTerms = terms
	snapshot.IsLatest = true
	_, err = p.snapshotRepo.CreateOrUpdate(ctx, snapshot)
	if err != nil {
		return fmt.Errorf("save snapshot: %w", err)
	}
	return nil
}

// collectLemmaSnapshotLookupTerms builds the lookup_terms for a snapshot.
// Includes forms that "belong" to this lemma for lookup purposes:
//   - The lemma surface itself (always)
//   - Forms with prefix relationship to the lemma (e.g., "others" for "other")
//   - Forms without prefix relationship IF they don't conflict with another lemma
//     (e.g., "went" for "go" — "went" is not any lemma's surface, so no conflict)
//
// A form conflicts when another lemma's surface is a prefix of the form
// (e.g., "others" for lemma "another" — "other" is a better prefix owner).
func collectLemmaSnapshotLookupTerms(lemma *entity.Lemma, forms []*entity.LemmaForm, allLemmaSurfaces map[string]struct{}) []string {
	if lemma == nil {
		return nil
	}

	lemmaNorm := strings.ToLower(strings.TrimSpace(lemma.Surface))
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

	appendTerm(lemmaNorm)

	for _, f := range forms {
		if f == nil {
			continue
		}
		formNorm := strings.ToLower(strings.TrimSpace(f.Surface))
		if formNorm == "" || formNorm == lemmaNorm {
			continue
		}

		// Always include forms with prefix relationship.
		if strings.HasPrefix(formNorm, lemmaNorm) || strings.HasPrefix(lemmaNorm, formNorm) {
			appendTerm(formNorm)
			continue
		}

		// No prefix relationship (suppletive form like "went" for "go").
		// Include UNLESS another lemma's surface is a better prefix match for this form.
		if !formOwnedByOtherLemma(formNorm, lemmaNorm, allLemmaSurfaces) {
			appendTerm(formNorm)
		}
	}
	return terms
}

// formOwnedByOtherLemma checks if any other lemma surface is a prefix of the form,
// meaning that lemma has stronger ownership of this form.
func formOwnedByOtherLemma(formNorm, currentLemmaNorm string, allLemmaSurfaces map[string]struct{}) bool {
	if allLemmaSurfaces == nil {
		return false
	}
	for surface := range allLemmaSurfaces {
		if surface == currentLemmaNorm {
			continue
		}
		if strings.HasPrefix(formNorm, surface) {
			return true
		}
	}
	return false
}

func (p *Persistence) loadAllLemmaSurfaces(ctx context.Context) map[string]struct{} {
	p.lemmaSurfacesMu.Lock()
	defer p.lemmaSurfacesMu.Unlock()

	if p.lemmaSurfacesCache != nil {
		return p.lemmaSurfacesCache
	}

	surfaces, err := p.lemmaRepo.ListAllSurfaces(ctx)
	if err != nil {
		p.logger.Warn("failed to load lemma surfaces for lookup_terms dedup", "error", err)
		return nil
	}

	cache := make(map[string]struct{}, len(surfaces))
	for _, s := range surfaces {
		cache[strings.ToLower(s)] = struct{}{}
	}
	p.lemmaSurfacesCache = cache
	return cache
}

// InvalidateLemmaSurfacesCache clears the cached lemma surfaces.
// Called when a new lemma is created.
func (p *Persistence) InvalidateLemmaSurfacesCache() {
	p.lemmaSurfacesMu.Lock()
	defer p.lemmaSurfacesMu.Unlock()
	p.lemmaSurfacesCache = nil
}

// collectUniqueForms deduplicates forms from the process result.
func collectUniqueForms(result *scoring.ProcessResult) []*entity.LemmaForm {
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
	if len(extIDs) == 0 {
		return map[string]*entity.Lexeme{}
	}

	// Batch lookup all external IDs in a single query
	ids := make([]string, 0, len(extIDs))
	for id := range extIDs {
		ids = append(ids, id)
	}
	result, err := p.lexemeRepo.BatchGetByExternalIDs(ctx, ids)
	if err != nil {
		p.logger.Warn("batch resolve lexeme ExternalIDs failed, falling back to individual lookups",
			"count", len(ids), "error", err)
		// Fallback to individual lookups
		result = make(map[string]*entity.Lexeme, len(ids))
		for _, id := range ids {
			lex, err := p.lexemeRepo.GetByExternalID(ctx, id)
			if err != nil {
				continue
			}
			result[id] = lex
		}
	}
	return result
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

func (p *Persistence) loadRelationTargetLookup(ctx context.Context, relations []*entity.SemanticRelation, sourceLexemeByExternalID map[string]*entity.Lexeme) map[entity.Language]map[string][]*repository.LemmaFormInfo {
	targetTermsByLang := collectTargetTermsByLanguage(relations, sourceLexemeByExternalID)
	targetLookup := make(map[entity.Language]map[string][]*repository.LemmaFormInfo, len(targetTermsByLang))
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
	targetLookup map[entity.Language]map[string][]*repository.LemmaFormInfo,
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
		if scoring.SourceProviderTrustRank(rel.Provider) > scoring.SourceProviderTrustRank(existing.Provider) {
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

func chooseTargetLexemeID(source *entity.Lexeme, candidates []*repository.LemmaFormInfo) *int64 {
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

// mapUnmappedContribRelations maps relations without SourceExternalID to available lexemes
// using POS and gloss similarity matching (same logic as GenericSourceProcessor).
func (p *Persistence) mapUnmappedContribRelations(relations []*entity.SemanticRelation, availableLexemes []*entity.Lexeme) {
	if len(relations) == 0 || len(availableLexemes) == 0 {
		return
	}

	// Build POS index
	lexemesByPOS := make(map[entity.PartOfSpeech][]*entity.Lexeme)
	for _, lex := range availableLexemes {
		lexemesByPOS[lex.PartOfSpeech] = append(lexemesByPOS[lex.PartOfSpeech], lex)
	}

	for _, rel := range relations {
		if rel.SourceExternalID != "" {
			continue
		}

		target := matchRelationToLexeme(rel, availableLexemes, lexemesByPOS)
		if target == nil {
			continue
		}

		rel.SourceExternalID = target.ExternalID
	}
}

// matchRelationToLexeme finds the best matching lexeme for a relation using POS and gloss.
func matchRelationToLexeme(rel *entity.SemanticRelation, allLexemes []*entity.Lexeme, lexemesByPOS map[entity.PartOfSpeech][]*entity.Lexeme) *entity.Lexeme {
	// If no POS hint, fall back to first lexeme
	if rel.SourcePOS == "" {
		return allLexemes[0]
	}

	pos := entity.PartOfSpeech(rel.SourcePOS)
	candidates := lexemesByPOS[pos]
	if len(candidates) == 0 {
		// No lexeme with matching POS — skip
		return nil
	}
	if len(candidates) == 1 {
		return candidates[0]
	}

	// Multiple candidates with same POS (homonyms) — use gloss similarity
	if rel.SourceGloss == "" {
		return candidates[0]
	}

	bestLex := candidates[0]
	bestScore := float64(-1)
	for _, lex := range candidates {
		score := lexemeGlossSimilarity(rel.SourceGloss, lex)
		if score > bestScore {
			bestScore = score
			bestLex = lex
		}
	}
	return bestLex
}

// lexemeGlossSimilarity computes the best Jaccard similarity between a source gloss
// and any gloss associated with the lexeme (SenseGloss or individual Senses).
func lexemeGlossSimilarity(sourceGloss string, lex *entity.Lexeme) float64 {
	best := glossJaccard(sourceGloss, lex.SenseGloss)
	for _, s := range lex.Senses {
		if score := glossJaccard(sourceGloss, s.Gloss); score > best {
			best = score
		}
	}
	return best
}

// glossJaccard computes Jaccard similarity on lowercased word tokens.
func glossJaccard(a, b string) float64 {
	tokA := tokenizeGloss(a)
	tokB := tokenizeGloss(b)
	if len(tokA) == 0 || len(tokB) == 0 {
		return 0
	}

	setA := make(map[string]struct{}, len(tokA))
	for _, t := range tokA {
		setA[t] = struct{}{}
	}
	setB := make(map[string]struct{}, len(tokB))
	for _, t := range tokB {
		setB[t] = struct{}{}
	}

	inter := 0
	for t := range setA {
		if _, ok := setB[t]; ok {
			inter++
		}
	}

	union := len(setA)
	for t := range setB {
		if _, ok := setA[t]; !ok {
			union++
		}
	}
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

// tokenizeGloss splits a gloss string into lowercase word tokens.
func tokenizeGloss(s string) []string {
	return strings.Fields(strings.ToLower(s))
}

// --- Relation reference helpers ---
func internalLexemeRef(id int64) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("vocnet://lexeme/%d", id)
}

func parseWikidataLexemeRef(ref string) string {
	const prefix = "wikidata://lexeme/"
	if !strings.HasPrefix(ref, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(ref, prefix))
}

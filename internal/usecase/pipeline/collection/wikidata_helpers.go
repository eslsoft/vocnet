package collection

import (
	"fmt"
	"sort"
	"strings"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
)

// filterLexemesByLemmaGroup groups lexemes by their Wikidata lemma and filters
// out groups that are clearly unrelated to the search term. This prevents
// mixing lexemes from different headwords (e.g., "other" vs "another") when
// they share a common form, while preserving derivationally related groups
// (e.g., "work" and "working").
//
// A group is "related" to the search term if:
//   - Its lemma equals the term exactly (case-insensitive), OR
//   - Its lemma is a prefix of the term (e.g., "work" → "working")
//
// If no groups are related, fall back to largest group with alphabetical
// tiebreaker to guarantee deterministic output.
// filterLexemesByLemma keeps only lexemes whose Wikidata lemma matches the term.
// Term is already resolved to a canonical lemma surface at job submission time,
// so only exact matches are valid.
func filterLexemesByLemma(lexemes []provider.WikidataLexeme, term string) []provider.WikidataLexeme {
	termLower := strings.ToLower(strings.TrimSpace(term))
	result := make([]provider.WikidataLexeme, 0, len(lexemes))
	for _, lex := range lexemes {
		if strings.ToLower(strings.TrimSpace(lex.Lemma)) == termLower {
			result = append(result, lex)
		}
	}
	return result
}

// wikidataPOSQIDMap maps Wikidata POS QIDs to canonical POS.
var wikidataPOSQIDMap = map[string]entity.PartOfSpeech{
	"q1084":      entity.PartOfSpeechNoun,
	"q24905":     entity.PartOfSpeechVerb,
	"q34698":     entity.PartOfSpeechAdjective,
	"q380057":    entity.PartOfSpeechAdverb,
	"q147276":    entity.PartOfSpeechProperNoun,
	"q36224":     entity.PartOfSpeechPronoun,
	"q4833830":   entity.PartOfSpeechAdposition,
	"q163875":    entity.PartOfSpeechAdposition,
	"q36484":     entity.PartOfSpeechCCONJ,
	"q83034":     entity.PartOfSpeechInterjection,
	"q1931259":   entity.PartOfSpeechDeterminer,
	"q63116":     entity.PartOfSpeechNumeral,
	"q184943":    entity.PartOfSpeechSuffix,
	"q62155":     entity.PartOfSpeechNoun,
	"q169872":    entity.PartOfSpeechAbbreviation,
	"q187931":    entity.PartOfSpeechAffix,
	"q1401131":   entity.PartOfSpeechPrefix,
	"q102047":    entity.PartOfSpeechSuffix,
	"q134830":    entity.PartOfSpeechPrefix,
	"q54310231":  entity.PartOfSpeechPronoun,
	"q576271":    entity.PartOfSpeechDeterminer,
	"q468801":    entity.PartOfSpeechPronoun,
	"q5051":      entity.PartOfSpeechDeterminer,
	"q7250170":   entity.PartOfSpeechAdjective,
	"q10265745":  entity.PartOfSpeechDeterminer,
	"q1050744":   entity.PartOfSpeechPronoun,
	"q10535365":  entity.PartOfSpeechParticle,
	"q113076880": entity.PartOfSpeechAdverb,
	"q113198319": entity.PartOfSpeechParticle,
	"q1668170":   entity.PartOfSpeechAdverb,
	"q1989081":   entity.PartOfSpeechPronoun,
	"q2304610":   entity.PartOfSpeechPronoun,
	"q2865743":   entity.PartOfSpeechDeterminer,
	"q34793275":  entity.PartOfSpeechPronoun,
	"q3813849":   entity.PartOfSpeechDeterminer,
	"q3976700":   entity.PartOfSpeechSuffix,
	"q66614509":  entity.PartOfSpeechSuffix,
	"q956030":    entity.PartOfSpeechPronoun,
	"q7233569":   entity.PartOfSpeechAdjective,
	"q102786":    entity.PartOfSpeechAbbreviation,
	"q1778442":   entity.PartOfSpeechVerb,
	"q107614077": entity.PartOfSpeechAffix,
	"q1964223":   entity.PartOfSpeechSuffix,
	"q953129":    entity.PartOfSpeechPronoun,
	"q66614499":  entity.PartOfSpeechSuffix,
	"q106610283": entity.PartOfSpeechSuffix,
	"q161873":    entity.PartOfSpeechAdposition,
	"q131431824": entity.PartOfSpeechVerb,
	"q5978305":   entity.PartOfSpeechSCONJ,
	"q101244":    entity.PartOfSpeechAbbreviation,
	"q1462657":   entity.PartOfSpeechPronoun,
	"q3397768":   entity.PartOfSpeechAdposition,
	"q10319522":  entity.PartOfSpeechAdposition,
	"q1167104":   entity.PartOfSpeechSCONJ,
	"q29888377":  entity.PartOfSpeechNoun,

	// Phrases, locutions, and multi-word expressions
	"q184511":    entity.PartOfSpeechNoun,       // idiom
	"q1527589":   entity.PartOfSpeechVerb,       // phrasal verb
	"q10976085":  entity.PartOfSpeechVerb,       // verbal locution
	"q3734650":   entity.PartOfSpeechAdverb,     // adverbial phrase
	"q5978303":   entity.PartOfSpeechAdverb,     // adverbial locution
	"q357760":    entity.PartOfSpeechAdjective,  // adjectival locution
	"q12734432":  entity.PartOfSpeechAdjective,  // attributive locution
	"q10319520":  entity.PartOfSpeechInterjection, // interjectional locution
	"q20430476":  entity.PartOfSpeechPronoun,    // pronominal locution
	"q6935164":   entity.PartOfSpeechNoun,       // multiword expression
	"q1122269":   entity.PartOfSpeechNoun,       // collocation
	"q65280376":  entity.PartOfSpeechNoun,       // everyday collocation
	"q5456361":   entity.PartOfSpeechNoun,       // fixed expression
	"q7188068":   entity.PartOfSpeechNoun,       // phrasal template

	// Proverbs, sayings, slogans
	"q35102":     entity.PartOfSpeechNoun,       // proverb
	"q3026787":   entity.PartOfSpeechNoun,       // saying
	"q30515":     entity.PartOfSpeechNoun,       // slogan
	"q11073520":  entity.PartOfSpeechNoun,       // formulaic language

	// Special noun subtypes
	"q217438":    entity.PartOfSpeechNoun,       // demonym
	"q81058955":  entity.PartOfSpeechNoun,       // national demonym
	"q7884789":   entity.PartOfSpeechProperNoun, // toponym
	"q1787727":   entity.PartOfSpeechNoun,       // agent noun

	// Morphological and other
	"q80071":     entity.PartOfSpeechSymbol,     // symbol
	"q43249":     entity.PartOfSpeechAffix,      // morpheme
	"q1153504":   entity.PartOfSpeechAffix,      // interfix
	"q191494":    entity.PartOfSpeechOther,      // digraph
	"q2034977":   entity.PartOfSpeechAdverb,     // prepositional adverb
	"q5283216":   entity.PartOfSpeechPronoun,    // distributive pronoun
	"q4335462":   entity.PartOfSpeechPronoun,    // definite pronoun
	"q918270":    entity.PartOfSpeechAbbreviation, // initialism
	"q130270424": entity.PartOfSpeechPronoun,     // interrogative expression
	"q126473":    entity.PartOfSpeechOther,        // contraction
	"q9788":      entity.PartOfSpeechOther,        // letter
	"q111029":    entity.PartOfSpeechAffix,        // root (morphological)
}

// parseWikidataPOS parses Wikidata POS QID to canonical POS.
func parseWikidataPOS(raw string) (entity.PartOfSpeech, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return entity.PartOfSpeechUnspecified, fmt.Errorf("empty wikidata pos")
	}

	token := strings.ToLower(raw)
	if mapped, ok := wikidataPOSQIDMap[token]; ok {
		return mapped, nil
	}

	// Try entity.ParsePartOfSpeech as fallback for non-QID values
	if !strings.HasPrefix(token, "q") {
		if pos, ok := entity.ParsePartOfSpeech(raw); ok {
			return pos, nil
		}
	}

	return entity.PartOfSpeechUnspecified, fmt.Errorf("unmapped wikidata pos: %s", raw)
}

// mapGrammaticalFeaturesToFormType maps Wikidata grammatical features to FormType.
func mapGrammaticalFeaturesToFormType(features []string) entity.FormType {
	if len(features) == 0 {
		return entity.FormTypeLemma
	}

	hasThirdPerson := false
	hasSingular := false

	for _, qid := range features {
		switch qid {
		case "Q146786": // plural
			return entity.FormTypePlural
		case "Q1994301", "Q1230649": // past tense / simple past
			return entity.FormTypePast
		case "Q12612489", "Q1392475": // past participle
			return entity.FormTypePastParticiple
		case "Q10345583": // present participle / gerund
			return entity.FormTypePresentParticiple
		case "Q14169499": // comparative
			return entity.FormTypeComparative
		case "Q1817208": // superlative
			return entity.FormTypeSuperlative
		case "Q51929049", "Q51929074": // third person
			hasThirdPerson = true
		case "Q110786": // singular
			hasSingular = true
		case "Q3910936": // lemma/base form marker
			// informational only
		}
	}

	if hasThirdPerson && hasSingular {
		return entity.FormTypeThirdPersonSingular
	}

	return entity.FormTypeUnspecified
}

// defaultDialect returns the default BCP 47 dialect tag for a language
// when the data source does not specify one.
func defaultDialect(lang entity.Language) string {
	switch lang {
	case entity.LanguageEnglish:
		return "en-GB"
	case entity.LanguageChinese:
		return "zh-CN"
	default:
		return lang.Code()
	}
}

// rejectLowConfidenceLexemeMatch checks if evidence indicates a low-confidence match.
func rejectLowConfidenceLexemeMatch(evidence map[string]any) bool {
	if len(evidence) == 0 {
		return false
	}
	score, ok := evidence["match_score"]
	if !ok {
		return false
	}
	scoreNum, ok := score.(int)
	if !ok {
		if f, okf := score.(float64); okf {
			scoreNum = int(f)
			ok = true
		}
	}
	if !ok {
		return false
	}
	if scoreNum > 40 {
		return false
	}
	countAny, ok := evidence["candidate_count"]
	if !ok {
		return false
	}
	switch v := countAny.(type) {
	case int:
		return v > 1
	case int32:
		return v > 1
	case int64:
		return v > 1
	case float64:
		return int(v) > 1
	default:
		return false
	}
}

// pickSenseGloss returns the first non-empty gloss from senses.
func pickSenseGloss(senses []entity.LexemeSense) string {
	for _, s := range senses {
		if s.Gloss != "" {
			return s.Gloss
		}
	}
	return ""
}

// ensureSurfaceForm ensures the given surface form exists in forms list.
// Does NOT assign FormTypeLemma — only the Wikidata lemma representation is authoritative.
func ensureSurfaceForm(forms []*entity.LemmaForm, surface string) []*entity.LemmaForm {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return forms
	}

	for _, f := range forms {
		if f == nil {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(f.Surface), surface) {
			return forms
		}
	}

	return append(forms, &entity.LemmaForm{
		Surface:    surface,
		Normalized: strings.ToLower(surface),
		FormType:   entity.FormTypeUnspecified,
	})
}

// convertProviderLexeme converts a provider lexeme to entity lexeme and forms.
func convertProviderLexeme(lex provider.WikidataLexeme, term string, lang entity.Language) (*entity.Lexeme, []*entity.LemmaForm, error) {
	pos, err := parseWikidataPOS(lex.POS)
	if err != nil {
		return nil, nil, fmt.Errorf("pos mapping failed: %w", err)
	}

	senses := make([]entity.LexemeSense, 0, len(lex.Senses))
	for _, s := range lex.Senses {
		for sLang, gloss := range s.Glosses {
			senses = append(senses, entity.LexemeSense{
				Language: entity.ParseLanguage(sLang),
				Gloss:    gloss,
				Provider: "wikidata",
			})
		}
	}

	// Ensure the Wikidata lemma representation is always present as FormTypeLemma.
	// This is the authoritative headword from Wikidata, not guessed from features.
	lemmaRepr := strings.TrimSpace(lex.Lemma)

	forms := make([]*entity.LemmaForm, 0, len(lex.Forms)+1)
	hasLemmaReprForm := false
	for _, form := range lex.Forms {
		if form.Representation == "" {
			continue
		}

		phonetics := make([]entity.Phonetic, 0, len(form.Phonetics))
		for _, ph := range form.Phonetics {
			dialect := ph.Dialect
			if dialect == "" {
				dialect = defaultDialect(lang)
			}
			phonetics = append(phonetics, entity.Phonetic{
				IPA:      ph.IPA,
				Dialect:  dialect,
				Provider: "wikidata",
			})
		}

		formType := mapGrammaticalFeaturesToFormType(form.Features)

		// If this form matches the Wikidata lemma representation, force FormTypeLemma.
		if lemmaRepr != "" && strings.EqualFold(form.Representation, lemmaRepr) {
			formType = entity.FormTypeLemma
			hasLemmaReprForm = true
		}

		forms = append(forms, &entity.LemmaForm{
			Surface:   form.Representation,
			FormType:  formType,
			Phonetics: phonetics,
		})
	}

	// If the lemma representation wasn't found among forms, add it explicitly.
	if lemmaRepr != "" && !hasLemmaReprForm {
		forms = append(forms, &entity.LemmaForm{
			Surface:  lemmaRepr,
			FormType: entity.FormTypeLemma,
		})
	}

	entityLexeme := &entity.Lexeme{
		ExternalID:   lex.LexemeID,
		Language:     entity.ParseLanguage(lex.Language),
		PartOfSpeech: pos,
		EntryType:    entity.LexemeEntryTypeWord,
		SenseGloss:   pickSenseGloss(senses),
		Senses:       senses,
	}

	return entityLexeme, forms, nil
}

// buildRelationLookupTerms builds lookup terms for relation discovery.
func buildRelationLookupTerms(pctx *pipeline.PipelineContext) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, 8)
	add := func(s string) {
		v := strings.TrimSpace(s)
		if v == "" {
			return
		}
		key := strings.ToLower(v)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, v)
	}

	add(pctx.Term)
	for _, f := range pctx.Forms {
		if f == nil {
			continue
		}
		add(f.Surface)
	}
	sort.SliceStable(out, func(i, j int) bool { return len(out[i]) < len(out[j]) })
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

// wikidataLexemeRef constructs a wikidata://lexeme/L-number reference.
func wikidataLexemeRef(lexemeID string) string {
	lexemeID = strings.TrimSpace(lexemeID)
	if lexemeID == "" {
		return ""
	}
	return "wikidata://lexeme/" + lexemeID
}

// pickRelationTerm picks the best term for a relation target.
func pickRelationTerm(lex provider.WikidataLexeme, fallback string) string {
	best := strings.TrimSpace(fallback)
	for _, f := range lex.Forms {
		surface := strings.TrimSpace(f.Representation)
		if surface == "" {
			continue
		}
		if best == "" || len(surface) < len(best) {
			best = surface
		}
	}
	if best == "" {
		best = lex.LexemeID
	}
	return best
}

// addRelation adds a relation if not already seen.
func addRelation(
	relations []*entity.SemanticRelation,
	seen map[string]struct{},
	sourceExternalID string,
	targetExternalID string,
	targetTerm string,
) []*entity.SemanticRelation {
	targetRef := wikidataLexemeRef(targetExternalID)
	if targetRef == "" {
		return relations
	}
	key := entity.RelationAssociation + "|" + strings.ToLower(targetRef)
	if _, ok := seen[key]; ok {
		return relations
	}
	seen[key] = struct{}{}
	term := strings.TrimSpace(targetTerm)
	if term == "" {
		term = targetExternalID
	}
	return append(relations, &entity.SemanticRelation{
		SourceExternalID: sourceExternalID,
		TargetRef:        targetRef,
		TargetTerm:       term,
		RelationType:     entity.RelationAssociation,
		Provider:         "wikidata",
		Strength:         0.9,
		SenseMapped:      false, // association by lexeme neighborhood, not actual sense mapping
	})
}

// =============================================================================
// Category Inference
// =============================================================================

// inferCategoriesFromSenses infers category tags from lexeme senses.
func inferCategoriesFromSenses(senses []entity.LexemeSense) []string {
	glosses := collectGlossTexts(senses)
	if len(glosses) == 0 {
		return []string{}
	}

	categories := []string{}

	for _, gloss := range glosses {
		// Try to infer entity types and their categories
		if cats, ok := inferPersonName(gloss); ok {
			categories = appendUnique(categories, cats...)
			continue
		}
		if cats, ok := inferPlace(gloss); ok {
			categories = appendUnique(categories, cats...)
			continue
		}
		if cats, ok := inferDemonym(gloss); ok {
			categories = appendUnique(categories, cats...)
			continue
		}
		if cats, ok := inferTime(gloss); ok {
			categories = appendUnique(categories, cats...)
			continue
		}
		if cats, ok := inferOrganization(gloss); ok {
			categories = appendUnique(categories, cats...)
			continue
		}
		if cats, ok := inferProduct(gloss); ok {
			categories = appendUnique(categories, cats...)
			continue
		}
		if cats, ok := inferOtherEntities(gloss); ok {
			categories = appendUnique(categories, cats...)
			continue
		}
		categories = appendPhraseCategories(categories, gloss)
	}

	return categories
}

func collectGlossTexts(senses []entity.LexemeSense) []string {
	glosses := make([]string, 0, len(senses))
	for _, sense := range senses {
		if sense.Gloss != "" {
			glosses = append(glosses, strings.ToLower(sense.Gloss))
		}
	}
	return glosses
}

func inferPersonName(gloss string) ([]string, bool) {
	if strings.Contains(gloss, "family name") || strings.Contains(gloss, "surname") {
		return []string{"entity:person", "person:family-name"}, true
	}
	if strings.Contains(gloss, "given name") || strings.Contains(gloss, "first name") {
		categories := []string{"entity:person", "person:given-name"}
		// Check female first (since "female" contains "male" as substring)
		switch {
		case strings.Contains(gloss, "female"):
			categories = append(categories, "person:female-name")
		case strings.Contains(gloss, "male"):
			categories = append(categories, "person:male-name")
		case strings.Contains(gloss, "unisex"):
			categories = append(categories, "person:unisex-name")
		}
		return categories, true
	}
	return nil, false
}

func inferPlace(gloss string) ([]string, bool) {
	categories := placeCategoriesFromGloss(gloss)
	if len(categories) == 0 {
		return nil, false
	}
	return categories, true
}

func placeCategoriesFromGloss(gloss string) []string {
	if strings.Contains(gloss, "city in") || strings.Contains(gloss, "city of") {
		return []string{"entity:place", "place:city"}
	}
	if isStandaloneCityGloss(gloss) {
		return []string{"entity:place", "place:city"}
	}

	for _, rule := range placeGlossRules() {
		if matchAnyPattern(gloss, rule.patterns) {
			return rule.categories
		}
	}

	return nil
}

type glossRule struct {
	patterns   []string
	categories []string
}

func placeGlossRules() []glossRule {
	return []glossRule{
		{patterns: []string{"town in", "town of"}, categories: []string{"entity:place", "place:town"}},
		{patterns: []string{"village in", "village of"}, categories: []string{"entity:place", "place:village"}},
		{patterns: []string{"municipality in"}, categories: []string{"entity:place", "place:municipality"}},
		{patterns: []string{"capital of"}, categories: []string{"entity:place", "place:capital", "place:city"}},
		{patterns: []string{"state in", "american state"}, categories: []string{"entity:place", "place:state"}},
		{patterns: []string{"country"}, categories: []string{"entity:place", "place:country"}},
		{patterns: []string{"territory"}, categories: []string{"entity:place", "place:territory"}},
		{patterns: []string{"province"}, categories: []string{"entity:place", "place:province"}},
		{patterns: []string{"region", "historic land"}, categories: []string{"entity:place", "place:region"}},
		{patterns: []string{"river in"}, categories: []string{"entity:place", "place:river"}},
		{patterns: []string{"mountain"}, categories: []string{"entity:place", "place:mountain"}},
		{patterns: []string{"lake in"}, categories: []string{"entity:place", "place:lake"}},
		{patterns: []string{"island"}, categories: []string{"entity:place", "place:island"}},
		{patterns: []string{"place name"}, categories: []string{"entity:place"}},
	}
}

func isStandaloneCityGloss(gloss string) bool {
	if strings.Contains(gloss, "city in") || strings.Contains(gloss, "city of") {
		return false
	}
	return strings.Contains(gloss, " city") || strings.HasSuffix(gloss, "city")
}

func inferDemonym(gloss string) ([]string, bool) {
	if matchAnyPattern(gloss, []string{
		"person from",
		"native of",
		"resident of",
		"citizens or residents of",
		"people of",
	}) {
		return []string{"attr:demonym"}, true
	}
	return nil, false
}

func inferTime(gloss string) ([]string, bool) {
	if matchAnyPattern(gloss, []string{"day after", "day of the week"}) {
		return []string{"entity:time", "attr:weekday"}, true
	}
	if strings.Contains(gloss, "month of the year") {
		return []string{"entity:time", "attr:month"}, true
	}
	return nil, false
}

func inferOrganization(gloss string) ([]string, bool) {
	if strings.Contains(gloss, "company") {
		return []string{"entity:organization", "org:company"}, true
	}
	if strings.Contains(gloss, "organization") {
		return []string{"entity:organization"}, true
	}
	if strings.Contains(gloss, "university") {
		return []string{"entity:organization", "org:university"}, true
	}
	return nil, false
}

func inferProduct(gloss string) ([]string, bool) {
	if strings.Contains(gloss, "video game") || strings.Contains(gloss, "web-based game") ||
		(strings.Contains(gloss, "game") && matchAnyPattern(gloss, []string{"created", "developed"})) {
		return []string{"product:game"}, true
	}
	if strings.Contains(gloss, "software") || strings.Contains(gloss, "application") {
		return []string{"product:software"}, true
	}
	if strings.Contains(gloss, "brand") {
		return []string{"product:brand"}, true
	}
	return nil, false
}

func inferOtherEntities(gloss string) ([]string, bool) {
	if strings.Contains(gloss, "language") {
		return []string{"entity:language"}, true
	}
	if strings.Contains(gloss, "ethnic group") {
		return []string{"entity:ethnic-group"}, true
	}
	if strings.Contains(gloss, "dog breed") {
		return []string{"attr:animal", "attr:dog-breed"}, true
	}
	if strings.Contains(gloss, "cat breed") {
		return []string{"attr:animal", "attr:cat-breed"}, true
	}
	if matchAnyPattern(gloss, []string{"concept", "theory", "principle", "hypothesis"}) {
		return []string{"attr:concept"}, true
	}
	return nil, false
}

func appendPhraseCategories(categories []string, gloss string) []string {
	if strings.Contains(gloss, "phrase") || strings.Contains(gloss, "idiom") {
		categories = appendUnique(categories, "attr:phrase")
	}
	if strings.Contains(gloss, "saying") || strings.Contains(gloss, "proverb") {
		categories = appendUnique(categories, "phrase", "saying")
	}
	return categories
}

func matchAnyPattern(gloss string, patterns []string) bool {
	for _, pattern := range patterns {
		if strings.Contains(gloss, pattern) {
			return true
		}
	}
	return false
}

// collectVariantSurfaces collects unique spelling variants from all lexemes.
func collectVariantSurfaces(lexemes []provider.WikidataLexeme) []string {
	seen := make(map[string]struct{})
	var variants []string
	for _, lex := range lexemes {
		for _, v := range lex.Variants {
			lower := strings.ToLower(v)
			if _, ok := seen[lower]; ok {
				continue
			}
			seen[lower] = struct{}{}
			variants = append(variants, v)
		}
	}
	return variants
}

// appendUnique appends items to a slice only if they don't already exist.
func appendUnique(slice []string, items ...string) []string {
	existing := make(map[string]bool)
	for _, item := range slice {
		existing[item] = true
	}
	for _, item := range items {
		if !existing[item] {
			slice = append(slice, item)
			existing[item] = true
		}
	}
	return slice
}

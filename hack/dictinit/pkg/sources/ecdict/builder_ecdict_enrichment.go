package ecdict

import (
	"strings"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/internal/entity"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
)

// BuildECDictEnrichmentForPOS builds ECDICT enrichment data filtered by target POS.
// This is used for enriching existing lexemes to avoid mixing senses from different POS.
func BuildECDictEnrichmentForPOS(word string, enrichment *ecdictEnrichment, targetPOS string) (*store.ImportLexemeData, error) {
	if word == "" || enrichment == nil {
		return nil, nil
	}

	// Normalize target POS for comparison
	targetPOS = normalizePOSForComparison(targetPOS)

	// Parse exchange to get forms
	var lemmaText string
	var forms []*entity.LemmaForm
	if enrichment.exchange != "" {
		lemmaText, forms = parseExchangeToEntity(word, enrichment.exchange)
	}

	// If no lemma from exchange, use word itself
	if lemmaText == "" {
		lemmaText = word
	}

	// Build senses - ONLY include senses matching the target POS
	senses := make([]entity.LexemeSense, 0)
	isLemma := strings.EqualFold(word, lemmaText)

	for _, sense := range enrichment.senses {
		// Skip Chinese senses for non-lemma forms
		if !isLemma && sense.language == commonv1.Language_LANGUAGE_CHINESE {
			continue
		}

		// Normalize sense POS for comparison
		sensePOS := normalizePOSForComparison(sense.partOfSpeech)

		// Only include senses that match the target POS
		if sensePOS == "" || sensePOS == targetPOS || isPOSCompatible(sensePOS, targetPOS) {
			senses = append(senses, entity.LexemeSense{
				Language: mapCommonLanguageToEntity(sense.language),
				Gloss:    sense.gloss,
			})
		}
	}

	// If no matching senses found, return nil (nothing to enrich)
	if len(senses) == 0 {
		return nil, nil
	}

	// Build phonetics for lemma
	phonetics := make([]entity.Phonetic, 0, len(enrichment.phonetics))
	for _, p := range enrichment.phonetics {
		phonetics = append(phonetics, entity.Phonetic{
			IPA:     p.GetIpa(),
			Dialect: p.GetDialect(),
		})
	}

	// Build SenseGloss (first sense gloss for quick preview)
	senseGloss := ""
	if len(senses) > 0 {
		senseGloss = senses[0].Gloss
	}

	// Build frequencies from BNC, FRQ, and Collins
	frequencies := buildFrequencies(enrichment.bnc, enrichment.frq, enrichment.collins)

	// Determine entry type (WORD vs PHRASE)
	entryType := determineEntryType(word)

	// Build lexeme with target POS
	lexeme := &entity.Lexeme{
		ExternalID:   "TL-ECDICT-" + word,
		Language:     entity.LanguageEnglish,
		PartOfSpeech: targetPOS, // Use the target POS, not from senses
		EntryType:    entryType,
		Frequencies:  frequencies,
		SenseGloss:   senseGloss,
		Senses:       senses,
		Completeness: calculateCompletenessECDict(senses, forms, phonetics),
	}

	// Attach phonetics to lemma forms
	lemmaForms := make([]*entity.LemmaForm, 0, len(forms)+1)

	// Deduplicate phonetics
	phonetics = deduplicatePhonetics(phonetics)

	// Determine which form should receive the phonetics
	phoneticsTarget := word

	// Add the lemma itself as a form
	lemmaPhonetics := []entity.Phonetic(nil)
	if strings.EqualFold(lemmaText, phoneticsTarget) {
		lemmaPhonetics = phonetics
	}

	if lemmaText != "" {
		lemmaForms = append(lemmaForms, &entity.LemmaForm{
			Surface:     lemmaText,
			Normalized:  strings.ToLower(lemmaText),
			FormType:    entity.LexemeFormTypeLemma,
			IsIrregular: false,
			Phonetics:   lemmaPhonetics,
		})
	}

	// Add other forms
	targetFound := strings.EqualFold(lemmaText, phoneticsTarget)

	for _, form := range forms {
		if form.FormType == entity.LexemeFormTypeLemma {
			continue
		}

		if strings.EqualFold(form.Surface, phoneticsTarget) {
			form.Phonetics = phonetics
			targetFound = true
		}

		lemmaForms = append(lemmaForms, form)
	}

	// If the word being enriched wasn't found in the forms list
	if !targetFound && len(phonetics) > 0 {
		lemmaForms = append(lemmaForms, &entity.LemmaForm{
			Surface:     phoneticsTarget,
			Normalized:  strings.ToLower(phoneticsTarget),
			FormType:    entity.LexemeFormTypeUnspecified,
			IsIrregular: false,
			Phonetics:   phonetics,
		})
	}

	// Build lemma data
	lemmaData := &store.ImportLemmaData{
		Surface:    lemmaText,
		Normalized: strings.ToLower(lemmaText),
		IsPrimary:  true,
		Forms:      lemmaForms,
	}

	return &store.ImportLexemeData{
		Lexeme: lexeme,
		Lemmas: []*store.ImportLemmaData{lemmaData},
	}, nil
}

// normalizePOSForComparison normalizes POS strings for comparison.
// Maps variations to canonical forms (e.g., "a", "adj", "adjective" -> "adj.")
func normalizePOSForComparison(pos string) string {
	pos = strings.ToLower(strings.TrimSpace(pos))
	pos = strings.TrimSuffix(pos, ".")

	switch pos {
	case "n", "noun":
		return "n."
	case "v", "verb", "vt", "vi":
		return "v."
	case "a", "adj", "adjective":
		return "adj."
	case "adv", "adverb":
		return "adv."
	case "prep", "preposition":
		return "prep."
	case "pron", "pronoun":
		return "pron."
	case "conj", "conjunction":
		return "conj."
	case "interj", "int", "interjection":
		return "interj."
	case "det", "determiner", "art", "article":
		return "det."
	case "num", "numeral":
		return "num."
	case "aux", "auxiliary":
		return "aux."
	case "abbr", "abbreviation":
		return "abbr."
	case "aff", "affix", "prefix", "suffix":
		return "aff."
	default:
		if pos != "" {
			return pos + "."
		}
		return ""
	}
}

// isPOSCompatible checks if two POS are compatible for sense matching.
// Some POS variations should be treated as compatible (e.g., "vt" and "vi" both match "v.").
func isPOSCompatible(pos1, pos2 string) bool {
	// Exact match
	if pos1 == pos2 {
		return true
	}

	// Empty POS matches anything (fallback case)
	if pos1 == "" || pos2 == "" {
		return true
	}

	// Special cases: verb variations
	verbPOS := map[string]bool{"v.": true, "vt.": true, "vi.": true}
	if verbPOS[pos1] && verbPOS[pos2] {
		return true
	}

	// Special cases: adjective variations
	adjPOS := map[string]bool{"adj.": true, "a.": true}
	if adjPOS[pos1] && adjPOS[pos2] {
		return true
	}

	return false
}

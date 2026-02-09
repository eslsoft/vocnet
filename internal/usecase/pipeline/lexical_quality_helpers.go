package pipeline

import (
	"fmt"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

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
	"q134830":    entity.PartOfSpeechPrefix,     // prefix
	"q54310231":  entity.PartOfSpeechPronoun,    // interrogative pronoun
	"q576271":    entity.PartOfSpeechDeterminer, // determiner
	"q468801":    entity.PartOfSpeechPronoun,    // personal pronoun
	"q5051":      entity.PartOfSpeechDeterminer, // possessive determiner
	"q7250170":   entity.PartOfSpeechAdjective,  // proper adjective (African, American, etc.)
	"q10265745":  entity.PartOfSpeechDeterminer, // demonstrative determiner
	"q1050744":   entity.PartOfSpeechPronoun,    // relative pronoun
	"q10535365":  entity.PartOfSpeechParticle,   // infinitive marker (to)
	"q113076880": entity.PartOfSpeechAdverb,     // postpositive adverb (ago)
	"q113198319": entity.PartOfSpeechParticle,   // adverbial particle (no)
	"q1668170":   entity.PartOfSpeechAdverb,     // interrogative adverb (where, when)
	"q1989081":   entity.PartOfSpeechPronoun,    // reflexive personal pronoun (yourself)
	"q2304610":   entity.PartOfSpeechPronoun,    // interrogative word (how, why)
	"q2865743":   entity.PartOfSpeechDeterminer, // definite article (the)
	"q34793275":  entity.PartOfSpeechPronoun,    // demonstrative pronoun (there, those)
	"q3813849":   entity.PartOfSpeechDeterminer, // indefinite article (an)
	"q3976700":   entity.PartOfSpeechSuffix,     // adjectival suffix (like, way)
	"q66614509":  entity.PartOfSpeechSuffix,     // nominal suffix (phone)
	"q956030":    entity.PartOfSpeechPronoun,       // indefinite pronoun (any, one, another)
	"q7233569":   entity.PartOfSpeechAdjective,    // postpositive adjective (ago)
	"q102786":    entity.PartOfSpeechAbbreviation, // abbreviation (who)
	"q1778442":   entity.PartOfSpeechVerb,         // verb phrase (makeup)
	"q107614077": entity.PartOfSpeechAffix,        // combining form (step)
}

func parsePOSFromSource(source, raw string) (entity.PartOfSpeech, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return entity.PartOfSpeechUnspecified, fmt.Errorf("empty pos from %s", source)
	}

	switch strings.ToLower(strings.TrimSpace(source)) {
	case "wikidata":
		return parseWikidataPOS(raw)
	case "ecdict":
		return parseECDICTPOS(raw)
	case "wordnet":
		return parseWordNetPOS(raw)
	default:
		return parseDelimitedPOS(raw)
	}
}

func parseWikidataPOS(raw string) (entity.PartOfSpeech, error) {
	token := strings.ToLower(strings.TrimSpace(raw))
	if mapped, ok := wikidataPOSQIDMap[token]; ok {
		return mapped, nil
	}
	if strings.HasPrefix(token, "q") {
		return entity.PartOfSpeechUnspecified, fmt.Errorf("unmapped wikidata pos qid: %s", raw)
	}
	return parseDelimitedPOS(raw)
}

// ecdictPOSMap maps ECDICT single-letter POS codes to canonical POS.
// ECDICT uses: n=noun, v=verb, j=adjective, r=adverb, a=article/determiner,
// t=particle (infinitive "to"), p=preposition, c=conjunction, etc.
var ecdictPOSMap = map[string]entity.PartOfSpeech{
	"n": entity.PartOfSpeechNoun,
	"v": entity.PartOfSpeechVerb,
	"j": entity.PartOfSpeechAdjective,
	"r": entity.PartOfSpeechAdverb,
	"a": entity.PartOfSpeechDeterminer, // article/determiner (the, my, your)
	"t": entity.PartOfSpeechParticle,   // infinitive marker "to"
	"s": entity.PartOfSpeechAdjective,  // satellite adjective
	"p": entity.PartOfSpeechAdposition,
	"c": entity.PartOfSpeechCCONJ,
	"u": entity.PartOfSpeechInterjection,
	"i": entity.PartOfSpeechInterjection,
	"m": entity.PartOfSpeechNumeral,
	"d": entity.PartOfSpeechDeterminer,
	"x": entity.PartOfSpeechOther,
}

// parseECDICTPOS parses ECDICT POS format like "n:100", "v:15/n:85", "j:88/n:12".
// It extracts the POS with highest percentage and maps to canonical POS.
func parseECDICTPOS(raw string) (entity.PartOfSpeech, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return entity.PartOfSpeechUnspecified, fmt.Errorf("empty pos")
	}

	// Split by "/" to handle multi-POS like "v:15/n:85"
	parts := strings.Split(raw, "/")

	var bestPOS string
	bestWeight := -1

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		// Handle format "x:NN" where x is POS letter and NN is percentage
		if idx := strings.Index(part, ":"); idx > 0 {
			posCode := strings.TrimSpace(part[:idx])
			weightStr := strings.TrimSpace(part[idx+1:])

			weight := 0
			_, _ = fmt.Sscanf(weightStr, "%d", &weight)

			if weight > bestWeight {
				bestWeight = weight
				bestPOS = posCode
			}
		} else if bestPOS == "" {
			// Plain POS without weight (e.g., just "n")
			bestPOS = part
		}
	}

	if bestPOS == "" {
		return entity.PartOfSpeechUnspecified, fmt.Errorf("no valid pos in: %s", raw)
	}

	// Map ECDICT POS code to canonical POS
	posLower := strings.ToLower(bestPOS)
	if mapped, ok := ecdictPOSMap[posLower]; ok {
		return mapped, nil
	}

	// Fallback to standard parsing
	if pos, ok := entity.ParsePartOfSpeech(bestPOS); ok {
		return pos, nil
	}

	return entity.PartOfSpeechUnspecified, fmt.Errorf("unmapped ecdict pos: %s", raw)
}

func parseWordNetPOS(raw string) (entity.PartOfSpeech, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "n":
		return entity.PartOfSpeechNoun, nil
	case "v":
		return entity.PartOfSpeechVerb, nil
	case "a", "s":
		return entity.PartOfSpeechAdjective, nil
	case "r":
		return entity.PartOfSpeechAdverb, nil
	default:
		return parseDelimitedPOS(raw)
	}
}

func parseDelimitedPOS(raw string) (entity.PartOfSpeech, error) {
	candidates := splitPOSCandidates(raw)
	for _, c := range candidates {
		if pos, ok := entity.ParsePartOfSpeech(c); ok {
			return pos, nil
		}
	}
	return entity.PartOfSpeechUnspecified, fmt.Errorf("unmapped pos: %s", raw)
}

func splitPOSCandidates(raw string) []string {
	out := []string{raw}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		switch r {
		case '/', ';', ',', '|', '&', '+':
			return true
		default:
			return false
		}
	})
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func pickSenseGloss(senses []entity.LexemeSense) string {
	for _, s := range senses {
		if s.Language == entity.LanguageEnglish && strings.TrimSpace(s.Gloss) != "" {
			return strings.TrimSpace(s.Gloss)
		}
	}
	for _, s := range senses {
		if strings.TrimSpace(s.Gloss) != "" {
			return strings.TrimSpace(s.Gloss)
		}
	}
	return ""
}

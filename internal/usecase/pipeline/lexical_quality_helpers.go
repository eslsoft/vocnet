package pipeline

import (
	"fmt"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

var wikidataPOSQIDMap = map[string]entity.PartOfSpeech{
	"q1084":    entity.PartOfSpeechNoun,
	"q24905":   entity.PartOfSpeechVerb,
	"q34698":   entity.PartOfSpeechAdjective,
	"q380057":  entity.PartOfSpeechAdverb,
	"q147276":  entity.PartOfSpeechProperNoun,
	"q36224":   entity.PartOfSpeechPronoun,
	"q4833830": entity.PartOfSpeechAdposition,
	"q163875":  entity.PartOfSpeechAdposition,
	"q36484":   entity.PartOfSpeechCCONJ,
	"q83034":   entity.PartOfSpeechInterjection,
	"q1931259": entity.PartOfSpeechDeterminer,
	"q63116":   entity.PartOfSpeechNumeral,
	"q184943":  entity.PartOfSpeechSuffix,
	"q62155":   entity.PartOfSpeechNoun,
	"q169872":  entity.PartOfSpeechAbbreviation,
	"q187931":  entity.PartOfSpeechAffix,
	"q1401131": entity.PartOfSpeechPrefix,
	"q102047":  entity.PartOfSpeechSuffix,
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
		return parseDelimitedPOS(raw)
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

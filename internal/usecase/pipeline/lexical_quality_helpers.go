package pipeline

import (
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

var wikidataPOSMap = map[string]string{
	// Common Wikidata POS items.
	"q1084":    "noun",
	"q24905":   "verb",
	"q34698":   "adjective",
	"q380057":  "adverb",
	"q147276":  "proper noun",
	"q36224":   "pronoun",
	"q163875":  "preposition",
	"q36484":   "conjunction",
	"q83034":   "interjection",
	"q1931259": "article",
	"q63116":   "numeral",
	"q184943":  "suffix",
}

func normalizePOSLabel(pos string) string {
	p := strings.ToLower(strings.TrimSpace(pos))
	p = strings.TrimSuffix(p, ".")

	if mapped, ok := wikidataPOSMap[p]; ok {
		return mapped
	}

	switch p {
	case "n", "noun":
		return "noun"
	case "v", "vi", "vt", "verb":
		return "verb"
	case "adj", "adjective":
		return "adjective"
	case "adv", "adverb":
		return "adverb"
	case "proper noun", "proper-noun", "propn":
		return "proper noun"
	case "pron", "pronoun":
		return "pronoun"
	case "det", "determiner":
		return "determiner"
	case "prep", "preposition":
		return "preposition"
	case "conj", "conjunction":
		return "conjunction"
	case "interj", "interjection":
		return "interjection"
	case "article":
		return "article"
	case "num", "numeral":
		return "numeral"
	case "particle":
		return "particle"
	case "suffix":
		return "suffix"
	default:
		return strings.TrimSpace(pos)
	}
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

package entity

import "strings"

// PartOfSpeech is the canonical internal POS enum used across all data sources.
// Core set = UPOS, plus a small controlled extension set.
type PartOfSpeech string

const (
	PartOfSpeechUnspecified  PartOfSpeech = ""
	PartOfSpeechNoun         PartOfSpeech = "noun"
	PartOfSpeechVerb         PartOfSpeech = "verb"
	PartOfSpeechAdjective    PartOfSpeech = "adj"
	PartOfSpeechAdverb       PartOfSpeech = "adv"
	PartOfSpeechPronoun      PartOfSpeech = "pron"
	PartOfSpeechProperNoun   PartOfSpeech = "propn"
	PartOfSpeechAdposition   PartOfSpeech = "adp"
	PartOfSpeechDeterminer   PartOfSpeech = "det"
	PartOfSpeechNumeral      PartOfSpeech = "num"
	PartOfSpeechCCONJ        PartOfSpeech = "cconj"
	PartOfSpeechSCONJ        PartOfSpeech = "sconj"
	PartOfSpeechParticle     PartOfSpeech = "part"
	PartOfSpeechInterjection PartOfSpeech = "intj"
	PartOfSpeechAuxiliary    PartOfSpeech = "aux"
	PartOfSpeechSymbol       PartOfSpeech = "sym"
	PartOfSpeechOther        PartOfSpeech = "x"

	// Controlled extensions over UPOS.
	PartOfSpeechAbbreviation PartOfSpeech = "abbr"
	PartOfSpeechAffix        PartOfSpeech = "affix"
	PartOfSpeechPrefix       PartOfSpeech = "prefix"
	PartOfSpeechSuffix       PartOfSpeech = "suffix"
)

var canonicalPartOfSpeechValues = []PartOfSpeech{
	PartOfSpeechNoun,
	PartOfSpeechVerb,
	PartOfSpeechAdjective,
	PartOfSpeechAdverb,
	PartOfSpeechPronoun,
	PartOfSpeechProperNoun,
	PartOfSpeechAdposition,
	PartOfSpeechDeterminer,
	PartOfSpeechNumeral,
	PartOfSpeechCCONJ,
	PartOfSpeechSCONJ,
	PartOfSpeechParticle,
	PartOfSpeechInterjection,
	PartOfSpeechAuxiliary,
	PartOfSpeechSymbol,
	PartOfSpeechOther,
	PartOfSpeechAbbreviation,
	PartOfSpeechAffix,
	PartOfSpeechPrefix,
	PartOfSpeechSuffix,
}

var partOfSpeechAliasMap = map[string]PartOfSpeech{
	"n":            PartOfSpeechNoun,
	"noun":         PartOfSpeechNoun,
	"v":            PartOfSpeechVerb,
	"vi":           PartOfSpeechVerb,
	"vt":           PartOfSpeechVerb,
	"verb":         PartOfSpeechVerb,
	"adj":          PartOfSpeechAdjective,
	"adjective":    PartOfSpeechAdjective,
	"a":            PartOfSpeechAdjective,
	"adv":          PartOfSpeechAdverb,
	"adverb":       PartOfSpeechAdverb,
	"r":            PartOfSpeechAdverb,
	"pron":         PartOfSpeechPronoun,
	"pronoun":      PartOfSpeechPronoun,
	"proper noun":  PartOfSpeechProperNoun,
	"proper-noun":  PartOfSpeechProperNoun,
	"propn":        PartOfSpeechProperNoun,
	"prep":         PartOfSpeechAdposition,
	"preposition":  PartOfSpeechAdposition,
	"adp":          PartOfSpeechAdposition,
	"det":          PartOfSpeechDeterminer,
	"determiner":   PartOfSpeechDeterminer,
	"article":      PartOfSpeechDeterminer,
	"num":          PartOfSpeechNumeral,
	"numeral":      PartOfSpeechNumeral,
	"conj":         PartOfSpeechCCONJ,
	"conjunction":  PartOfSpeechCCONJ,
	"cconj":        PartOfSpeechCCONJ,
	"sconj":        PartOfSpeechSCONJ,
	"subordinator": PartOfSpeechSCONJ,
	"part":         PartOfSpeechParticle,
	"particle":     PartOfSpeechParticle,
	"interj":       PartOfSpeechInterjection,
	"interjection": PartOfSpeechInterjection,
	"aux":          PartOfSpeechAuxiliary,
	"auxiliary":    PartOfSpeechAuxiliary,
	"sym":          PartOfSpeechSymbol,
	"symbol":       PartOfSpeechSymbol,
	"x":            PartOfSpeechOther,
	"other":        PartOfSpeechOther,

	"abbr":         PartOfSpeechAbbreviation,
	"abbrev":       PartOfSpeechAbbreviation,
	"abbreviation": PartOfSpeechAbbreviation,
	"affix":        PartOfSpeechAffix,
	"prefix":       PartOfSpeechPrefix,
	"suffix":       PartOfSpeechSuffix,

	// Phrase-like tags are normalized into noun/verb as requested.
	"phrase":      PartOfSpeechNoun,
	"noun phrase": PartOfSpeechNoun,
	"np":          PartOfSpeechNoun,
	"verb phrase": PartOfSpeechVerb,
	"vp":          PartOfSpeechVerb,
}

func normalizePOSToken(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimSuffix(s, ".")
	s = strings.Join(strings.Fields(s), " ")
	return s
}

// ParsePartOfSpeech parses a single POS token into the internal enum.
func ParsePartOfSpeech(raw string) (PartOfSpeech, bool) {
	token := normalizePOSToken(raw)
	if token == "" {
		return PartOfSpeechUnspecified, false
	}
	pos, ok := partOfSpeechAliasMap[token]
	if !ok {
		return PartOfSpeechUnspecified, false
	}
	return pos, true
}

// IsValidPartOfSpeech reports whether pos is one of the canonical enum values.
func IsValidPartOfSpeech(pos PartOfSpeech) bool {
	if pos == PartOfSpeechUnspecified {
		return false
	}
	_, ok := partOfSpeechAliasMap[strings.ToLower(string(pos))]
	return ok
}

// Values implements Ent's EnumValues contract for schema GoType.
func (PartOfSpeech) Values() []string {
	out := make([]string, 0, len(canonicalPartOfSpeechValues))
	for _, v := range canonicalPartOfSpeechValues {
		out = append(out, string(v))
	}
	return out
}

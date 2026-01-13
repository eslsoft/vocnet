package wikidata

import (
	"strings"
)

// WikidataLexeme mirrors the dump structure for lexemes.
type WikidataLexeme struct {
	Type            string                     `json:"type"`
	ID              string                     `json:"id"`
	Language        string                     `json:"language"`
	LexicalCategory string                     `json:"lexicalCategory"`
	Lemmas          map[string]WikidataValue   `json:"lemmas"`
	Forms           []WikidataForm             `json:"forms"`
	Senses          []WikidataSense            `json:"senses"`
	Claims          map[string][]WikidataClaim `json:"claims"`
}

type WikidataValue struct {
	Language string `json:"language"`
	Value    string `json:"value"`
}

type WikidataForm struct {
	ID                  string                     `json:"id"`
	Representations     map[string]WikidataValue   `json:"representations"`
	GrammaticalFeatures []string                   `json:"grammaticalFeatures"`
	Claims              map[string][]WikidataClaim `json:"claims"`
}

type WikidataSense struct {
	ID      string                     `json:"id"`
	Glosses map[string]WikidataValue   `json:"glosses"`
	Claims  map[string][]WikidataClaim `json:"claims"`
}

type WikidataClaim struct {
	MainSnak struct {
		Property  string `json:"property"`
		DataValue struct {
			Value interface{} `json:"value"`
			Type  string      `json:"type"`
		} `json:"datavalue"`
	} `json:"mainsnak"`
}

func mapLexicalCategoryToPOS(lexicalCategory string) string {
	return lexicalCategoryToPOS[lexicalCategory]
}

var lexicalCategoryToPOS = map[string]string{
	"Q1084":      "n.",
	"Q24905":     "v.",
	"Q34698":     "adj.",
	"Q380057":    "adv.",
	"Q36224":     "pron.",
	"Q177545":    "num.",
	"Q576271":    "num.",
	"Q63116":     "num.",
	"Q102786":    "abbr.",
	"Q101244":    "abbr.",
	"Q918270":    "abbr.",
	"Q126473":    "abbr.",
	"Q147276":    "n.",
	"Q7250170":   "adj.",
	"Q2304610":   "adv.",
	"Q4833830":   "prep.",
	"Q36484":     "conj.",
	"Q3734650":   "adv.",
	"Q1401131":   "n.",
	"Q29888377":  "n.",
	"Q7884789":   "n.",
	"Q191494":    "n.",
	"Q9788":      "n.",
	"Q80071":     "n.",
	"Q43249":     "n.",
	"Q134830":    "aff.",
	"Q102047":    "aff.",
	"Q66614509":  "aff.",
	"Q3976700":   "aff.",
	"Q1964223":   "aff.",
	"Q1153504":   "aff.",
	"Q107614077": "aff.",
	"Q106610283": "aff.",
	"Q468801":    "pron.",
	"Q54310231":  "pron.",
	"Q34793275":  "pron.",
	"Q1462657":   "pron.",
	"Q4335462":   "pron.",
	"Q1050744":   "pron.",
	"Q3397768":   "prep.",
	"Q10319522":  "prep.",
	"Q161873":    "prep.",
	"Q2034977":   "adv.",
	"Q1668170":   "adv.",
	"Q1167104":   "adv.",
	"Q113076880": "adv.",
	"Q113198319": "adv.",
	"Q10976085":  "v.",
	"Q1778442":   "v.",
	"Q1527589":   "v.",
	"Q10535365":  "v.",
	"Q357760":    "adj.",
	"Q7233569":   "adj.",
	"Q2865743":   "det.",
	"Q3813849":   "det.",
	"Q5051":      "det.",
	"Q10432772":  "prep.",
	"Q83034":     "interj.",
	"Q11471":     "det.",
	"Q814722":    "det.",
	"Q184943":    "conj.",
}

// POSAndCategories holds both POS and category tags inferred from glosses
type POSAndCategories struct {
	POS        string
	Categories []string
}

// inferPOSAndCategories attempts to infer the part-of-speech and category tags from sense glosses
// This is particularly useful for proper nouns and other words where Wikidata
// doesn't provide a lexicalCategory but the gloss contains clear indicators
func inferPOSAndCategories(senses []WikidataSense) POSAndCategories {
	glosses := collectGlosses(senses)
	if len(glosses) == 0 {
		return POSAndCategories{}
	}

	categories := []string{}

	for _, gloss := range glosses {
		if result, ok := inferPersonName(gloss); ok {
			return result
		}
		if result, ok := inferPlace(gloss); ok {
			return result
		}
		if result, ok := inferDemonym(gloss); ok {
			return result
		}
		if result, ok := inferTime(gloss); ok {
			return result
		}
		if result, ok := inferOrganization(gloss); ok {
			return result
		}
		if result, ok := inferProduct(gloss); ok {
			return result
		}
		if result, ok := inferOtherEntities(gloss); ok {
			return result
		}
		categories = appendPhraseCategories(categories, gloss)
	}

	// If we only found phrase/saying categories, return them without POS
	if len(categories) > 0 {
		return POSAndCategories{POS: "", Categories: categories}
	}

	// No pattern matched
	return POSAndCategories{}
}

// inferPOSFromGlosses is kept for backward compatibility, now calls inferPOSAndCategories
func inferPOSFromGlosses(senses []WikidataSense) string {
	return inferPOSAndCategories(senses).POS
}

func collectGlosses(senses []WikidataSense) []string {
	var glosses []string
	for _, sense := range senses {
		for _, glossValue := range sense.Glosses {
			if glossValue.Value != "" {
				glosses = append(glosses, strings.ToLower(glossValue.Value))
			}
		}
	}
	return glosses
}

func inferPersonName(gloss string) (POSAndCategories, bool) {
	if strings.Contains(gloss, "family name") || strings.Contains(gloss, "surname") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "entity:person", "person:family-name")}, true
	}
	if strings.Contains(gloss, "given name") || strings.Contains(gloss, "first name") {
		categories := appendUnique(nil, "entity:person", "person:given-name")
		if strings.Contains(gloss, "male") {
			categories = appendUnique(categories, "person:male-name")
		} else if strings.Contains(gloss, "female") {
			categories = appendUnique(categories, "person:female-name")
		} else if strings.Contains(gloss, "unisex") {
			categories = appendUnique(categories, "person:unisex-name")
		}
		return POSAndCategories{POS: "n.", Categories: categories}, true
	}
	return POSAndCategories{}, false
}

func inferPlace(gloss string) (POSAndCategories, bool) {
	categories := placeCategoriesFromGloss(gloss)
	if len(categories) == 0 {
		return POSAndCategories{}, false
	}
	return POSAndCategories{POS: "n.", Categories: appendUnique(nil, categories...)}, true
}

func placeCategoriesFromGloss(gloss string) []string {
	if strings.Contains(gloss, "city in") || strings.Contains(gloss, "city of") {
		return []string{"entity:place", "place:city"}
	}
	if isStandaloneCityGloss(gloss) {
		return []string{"entity:place", "place:city"}
	}

	for _, rule := range placeGlossRules() {
		if matchAny(gloss, rule.patterns) {
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

func inferDemonym(gloss string) (POSAndCategories, bool) {
	if matchAny(gloss, []string{
		"person from",
		"native of",
		"resident of",
		"citizens or residents of",
		"people of",
	}) {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "attr:demonym")}, true
	}
	return POSAndCategories{}, false
}

func inferTime(gloss string) (POSAndCategories, bool) {
	if matchAny(gloss, []string{"day after", "day of the week"}) {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "entity:time", "attr:weekday")}, true
	}
	if strings.Contains(gloss, "month of the year") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "entity:time", "attr:month")}, true
	}
	return POSAndCategories{}, false
}

func inferOrganization(gloss string) (POSAndCategories, bool) {
	if strings.Contains(gloss, "company") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "entity:organization", "org:company")}, true
	}
	if strings.Contains(gloss, "organization") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "entity:organization")}, true
	}
	if strings.Contains(gloss, "university") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "entity:organization", "org:university")}, true
	}
	return POSAndCategories{}, false
}

func inferProduct(gloss string) (POSAndCategories, bool) {
	if strings.Contains(gloss, "video game") || strings.Contains(gloss, "web-based game") ||
		(strings.Contains(gloss, "game") && matchAny(gloss, []string{"created", "developed"})) {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "product:game")}, true
	}
	if strings.Contains(gloss, "software") || strings.Contains(gloss, "application") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "product:software")}, true
	}
	if strings.Contains(gloss, "brand") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "product:brand")}, true
	}
	return POSAndCategories{}, false
}

func inferOtherEntities(gloss string) (POSAndCategories, bool) {
	if strings.Contains(gloss, "language") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "entity:language")}, true
	}
	if strings.Contains(gloss, "ethnic group") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "entity:ethnic-group")}, true
	}
	if strings.Contains(gloss, "dog breed") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "attr:animal", "attr:dog-breed")}, true
	}
	if strings.Contains(gloss, "cat breed") {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "attr:animal", "attr:cat-breed")}, true
	}
	if matchAny(gloss, []string{"concept", "theory", "principle", "hypothesis"}) {
		return POSAndCategories{POS: "n.", Categories: appendUnique(nil, "attr:concept")}, true
	}
	return POSAndCategories{}, false
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

func matchAny(gloss string, patterns []string) bool {
	for _, pattern := range patterns {
		if strings.Contains(gloss, pattern) {
			return true
		}
	}
	return false
}

// appendUnique appends items to a slice only if they don't already exist
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

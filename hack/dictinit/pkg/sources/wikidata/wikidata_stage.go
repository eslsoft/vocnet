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
	switch lexicalCategory {
	case "Q1084":
		return "n."
	case "Q24905":
		return "v."
	case "Q34698":
		return "adj."
	case "Q380057":
		return "adv."
	case "Q36224":
		return "pron."
	case "Q177545", "Q576271": // Q177545=numeral, Q576271=cardinal numeral
		return "num."
	case "Q63116": // numeral
		return "num."
	case "Q102786", "Q101244": // abbreviation, acronym
		return "abbr."
	case "Q918270": // initialism
		return "abbr."
	case "Q126473": // contraction
		return "abbr."
	case "Q147276": // proper noun
		return "n."
	case "Q7250170": // proper adjective
		return "adj."
	case "Q2304610": // interrogative word
		return "adv."
	case "Q4833830": // preposition
		return "prep."
	case "Q36484": // conjunction
		return "conj."
	case "Q3734650": // adverbial phrase
		return "adv."
	case "Q1401131": // noun phrase
		return "n."
	case "Q29888377": // nominal locution
		return "n."
	case "Q7884789": // toponym
		return "n."
	case "Q191494": // digraph
		return "n."
	case "Q9788": // letter
		return "n."
	case "Q80071": // symbol
		return "n."
	case "Q43249": // morpheme
		return "n."
	case "Q134830", "Q102047", "Q66614509": // prefix, suffix, nominal suffix
		return "aff."
	case "Q3976700": // adjectival suffix
		return "aff."
	case "Q1964223": // name suffix
		return "aff."
	case "Q1153504": // interfix
		return "aff."
	case "Q107614077": // combining form
		return "aff."
	case "Q106610283": // adverbial suffix
		return "aff."
	case "Q468801": // personal pronoun
		return "pron."
	case "Q54310231", "Q34793275", "Q1462657": // interrogative/demonstrative/reciprocal pronoun
		return "pron."
	case "Q4335462", "Q1050744": // definite/relative pronoun
		return "pron."
	case "Q3397768": // prepositional syntagma
		return "prep."
	case "Q10319522": // prepositional locution
		return "prep."
	case "Q161873": // postposition
		return "prep."
	case "Q2034977": // prepositional adverb
		return "adv."
	case "Q1668170": // interrogative adverb
		return "adv."
	case "Q1167104": // conjunctive adverb
		return "adv."
	case "Q113076880": // postpositive adverb
		return "adv."
	case "Q113198319": // adverbial particle
		return "adv."
	case "Q10976085": // verbal locution
		return "v."
	case "Q1778442": // verb phrase
		return "v."
	case "Q1527589": // phrasal verb
		return "v."
	case "Q10535365": // infinitive marker
		return "v."
	case "Q357760": // adjectival phrase
		return "adj."
	case "Q7233569": // postpositive adjective
		return "adj."
	case "Q2865743": // definite article
		return "det."
	case "Q3813849": // indefinite article
		return "det."
	case "Q5051": // possessive determiner
		return "det."
	case "Q10432772":
		return "prep."
	case "Q83034":
		return "interj."
	case "Q11471":
		return "det." // article -> determiner
	case "Q814722": // determiner
		return "det."
	case "Q184943": // conjunction
		return "conj."
	default:
		return ""
	}
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
	// Collect all glosses
	var glosses []string
	for _, sense := range senses {
		for _, glossValue := range sense.Glosses {
			if glossValue.Value != "" {
				glosses = append(glosses, strings.ToLower(glossValue.Value))
			}
		}
	}

	if len(glosses) == 0 {
		return POSAndCategories{}
	}

	categories := []string{}

	// Check each gloss for patterns
	for _, gloss := range glosses {
		// Person names
		if strings.Contains(gloss, "family name") || strings.Contains(gloss, "surname") {
			categories = appendUnique(categories, "entity:person", "person:family-name")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "given name") || strings.Contains(gloss, "first name") {
			categories = appendUnique(categories, "entity:person", "person:given-name")
			if strings.Contains(gloss, "male") {
				categories = appendUnique(categories, "person:male-name")
			} else if strings.Contains(gloss, "female") {
				categories = appendUnique(categories, "person:female-name")
			} else if strings.Contains(gloss, "unisex") {
				categories = appendUnique(categories, "person:unisex-name")
			}
			return POSAndCategories{POS: "n.", Categories: categories}
		}

		// Place names - specific types
		if strings.Contains(gloss, "city in") || strings.Contains(gloss, "city of") {
			categories = appendUnique(categories, "entity:place", "place:city")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		// Check for standalone "city" or patterns like "Canadian city"
		if (strings.Contains(gloss, " city") || strings.HasSuffix(gloss, "city")) &&
			!strings.Contains(gloss, "city in") && !strings.Contains(gloss, "city of") {
			categories = appendUnique(categories, "entity:place", "place:city")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "town in") || strings.Contains(gloss, "town of") {
			categories = appendUnique(categories, "entity:place", "place:town")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "village in") || strings.Contains(gloss, "village of") {
			categories = appendUnique(categories, "entity:place", "place:village")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "municipality in") {
			categories = appendUnique(categories, "entity:place", "place:municipality")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "capital of") {
			categories = appendUnique(categories, "entity:place", "place:capital", "place:city")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "state in") || strings.Contains(gloss, "american state") {
			categories = appendUnique(categories, "entity:place", "place:state")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "country") {
			categories = appendUnique(categories, "entity:place", "place:country")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "territory") {
			categories = appendUnique(categories, "entity:place", "place:territory")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "province") {
			categories = appendUnique(categories, "entity:place", "place:province")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "region") || strings.Contains(gloss, "historic land") {
			categories = appendUnique(categories, "entity:place", "place:region")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "river in") {
			categories = appendUnique(categories, "entity:place", "place:river")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "mountain") {
			categories = appendUnique(categories, "entity:place", "place:mountain")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "lake in") {
			categories = appendUnique(categories, "entity:place", "place:lake")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "island") {
			categories = appendUnique(categories, "entity:place", "place:island")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "place name") {
			categories = appendUnique(categories, "entity:place")
			return POSAndCategories{POS: "n.", Categories: categories}
		}

		// Demonyms (people from a place)
		if strings.Contains(gloss, "person from") || strings.Contains(gloss, "native of") ||
			strings.Contains(gloss, "resident of") || strings.Contains(gloss, "citizens or residents of") ||
			strings.Contains(gloss, "people of") {
			categories = appendUnique(categories, "attr:demonym")
			return POSAndCategories{POS: "n.", Categories: categories}
		}

		// Time-related
		if strings.Contains(gloss, "day after") || strings.Contains(gloss, "day of the week") {
			categories = appendUnique(categories, "entity:time", "attr:weekday")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "month of the year") {
			categories = appendUnique(categories, "entity:time", "attr:month")
			return POSAndCategories{POS: "n.", Categories: categories}
		}

		// Organizations
		if strings.Contains(gloss, "company") {
			categories = appendUnique(categories, "entity:organization", "org:company")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "organization") {
			categories = appendUnique(categories, "entity:organization")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "university") {
			categories = appendUnique(categories, "entity:organization", "org:university")
			return POSAndCategories{POS: "n.", Categories: categories}
		}

		// Products, Games, Media
		if strings.Contains(gloss, "video game") || strings.Contains(gloss, "web-based game") ||
			(strings.Contains(gloss, "game") && (strings.Contains(gloss, "created") || strings.Contains(gloss, "developed"))) {
			categories = appendUnique(categories, "product:game")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "software") || strings.Contains(gloss, "application") {
			categories = appendUnique(categories, "product:software")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "brand") {
			categories = appendUnique(categories, "product:brand")
			return POSAndCategories{POS: "n.", Categories: categories}
		}

		// Other entity types
		if strings.Contains(gloss, "language") {
			categories = appendUnique(categories, "entity:language")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "ethnic group") {
			categories = appendUnique(categories, "entity:ethnic-group")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "dog breed") {
			categories = appendUnique(categories, "attr:animal", "attr:dog-breed")
			return POSAndCategories{POS: "n.", Categories: categories}
		}
		if strings.Contains(gloss, "cat breed") {
			categories = appendUnique(categories, "attr:animal", "attr:cat-breed")
			return POSAndCategories{POS: "n.", Categories: categories}
		}

		// Scientific/Academic concepts
		if strings.Contains(gloss, "concept") || strings.Contains(gloss, "theory") ||
			strings.Contains(gloss, "principle") || strings.Contains(gloss, "hypothesis") {
			categories = appendUnique(categories, "attr:concept")
			return POSAndCategories{POS: "n.", Categories: categories}
		}

		// Phrases/idioms - typically don't have a single POS
		if strings.Contains(gloss, "phrase") || strings.Contains(gloss, "idiom") {
			categories = appendUnique(categories, "attr:phrase")
			// Don't return POS for phrases, continue checking
		}
		if strings.Contains(gloss, "saying") || strings.Contains(gloss, "proverb") {
			categories = appendUnique(categories, "phrase", "saying")
			// Don't return POS for sayings
		}
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

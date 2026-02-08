package pipeline

import (
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

// POSAndCategories holds both POS and category tags inferred from glosses.
type POSAndCategories struct {
	POS        string
	Categories []string
}

// InferCategoriesFromSenses infers category tags from lexeme senses.
// This logic is adapted from hack/dictinit/pkg/sources/wikidata/wikidata_stage.go
// to support the new semantic distillation pipeline.
func InferCategoriesFromSenses(senses []entity.LexemeSense) []string {
	glosses := collectGlossTexts(senses)
	if len(glosses) == 0 {
		return []string{}
	}

	categories := []string{}

	for _, gloss := range glosses {
		// Try to infer entity types and their categories
		if result, ok := inferPersonName(gloss); ok {
			categories = appendUnique(categories, result.Categories...)
			continue
		}
		if result, ok := inferPlace(gloss); ok {
			categories = appendUnique(categories, result.Categories...)
			continue
		}
		if result, ok := inferDemonym(gloss); ok {
			categories = appendUnique(categories, result.Categories...)
			continue
		}
		if result, ok := inferTime(gloss); ok {
			categories = appendUnique(categories, result.Categories...)
			continue
		}
		if result, ok := inferOrganization(gloss); ok {
			categories = appendUnique(categories, result.Categories...)
			continue
		}
		if result, ok := inferProduct(gloss); ok {
			categories = appendUnique(categories, result.Categories...)
			continue
		}
		if result, ok := inferOtherEntities(gloss); ok {
			categories = appendUnique(categories, result.Categories...)
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

func inferPersonName(gloss string) (POSAndCategories, bool) {
	if strings.Contains(gloss, "family name") || strings.Contains(gloss, "surname") {
		return POSAndCategories{
			POS:        "n.",
			Categories: appendUnique(nil, "entity:person", "person:family-name"),
		}, true
	}
	if strings.Contains(gloss, "given name") || strings.Contains(gloss, "first name") {
		categories := appendUnique(nil, "entity:person", "person:given-name")
		// Check female first (since "female" contains "male" as substring)
		switch {
		case strings.Contains(gloss, "female"):
			categories = appendUnique(categories, "person:female-name")
		case strings.Contains(gloss, "male"):
			categories = appendUnique(categories, "person:male-name")
		case strings.Contains(gloss, "unisex"):
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

// ExtractDomainCategories extracts domain categories from ECDICT tags.
// ECDICT tags format: []string{"zk", "gk"} (already split)
// Maps to domain categories like "domain:computing"
func ExtractDomainCategories(tags []string) []string {
	if len(tags) == 0 {
		return []string{}
	}

	categories := []string{}

	domainMap := map[string]string{
		"zk": "domain:computing",    // 计算机
		"jx": "domain:mechanics",    // 机械
		"hx": "domain:chemistry",    // 化学
		"yi": "domain:medicine",     // 医学
		"sw": "domain:biology",      // 生物
		"wy": "domain:physics",      // 物理
		"dl": "domain:geography",    // 地理
		"tw": "domain:astronomy",    // 天文
		"yy": "domain:music",        // 音乐
		"ty": "domain:sports",       // 体育
		"fx": "domain:law",          // 法律
		"jj": "domain:economics",    // 经济
		"js": "domain:military",     // 军事
		"jz": "domain:architecture", // 建筑
		"dz": "domain:electronics",  // 电子
		"sx": "domain:mathematics",  // 数学
	}

	for _, tag := range tags {
		if domain, ok := domainMap[tag]; ok {
			categories = appendUnique(categories, domain)
		}
	}

	return categories
}

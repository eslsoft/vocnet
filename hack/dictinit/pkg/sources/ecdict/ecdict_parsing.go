package ecdict

import (
	"database/sql"
	"fmt"
	"strings"

	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

var (
	posCandidates = []string{"vt", "vi", "adj", "adv", "prep", "pron", "conj", "interj", "int", "num", "art", "aux", "abbr", "pref", "suf", "noun", "n", "v", "a"}

	levelTags = map[string]bool{
		"gk":    true,
		"cet4":  true,
		"cet6":  true,
		"ky":    true,
		"toefl": true,
		"ielts": true,
		"gre":   true,
		"zk":    true,
	}

	attrTags = map[string]bool{
		"phrase": true,
		"saying": true,
	}

	domainMap = map[string]string{
		// Computing & Technology
		"计":   "computing",
		"计算机": "computing",
		"网络":  "network",
		"电":   "electronics",
		"电子":  "electronics",
		"电影":  "film",

		// Science
		"化":  "chemistry",
		"化学": "chemistry",
		"生":  "biology",
		"生物": "biology",
		"生化": "biochemistry",
		"生态": "ecology",
		"数":  "mathematics",
		"数学": "mathematics",
		"物":  "physics",
		"物理": "physics",
		"天":  "astronomy",
		"天文": "astronomy",
		"地":  "geography",
		"地理": "geography",
		"地质": "geology",
		"矿":  "mineralogy",
		"遗":  "genetics",

		// Life Sciences & Medicine
		"医":  "medicine",
		"医学": "medicine",
		"内科": "internal-medicine",
		"心理": "psychology",
		"植":  "botany",
		"植保": "plant-protection",
		"动":  "zoology",
		"昆":  "entomology",

		// Social Sciences
		"法":  "law",
		"经":  "economics",
		"经济": "economics",
		"财":  "finance",

		// Engineering & Industry
		"军":  "military",
		"军事": "military",
		"建":  "architecture",
		"建筑": "architecture",
		"机":  "mechanics",
		"机械": "mechanics",

		// Arts & Sports
		"音":  "music",
		"音乐": "music",
		"体":  "sports",
		"体育": "sports",

		// Entity types (should be recognized as entity categories, not domains)
		"地名": "entity:place",
		"人名": "entity:person",

		// Country names - not domains, skip
		"美国":  "",
		"德国":  "",
		"俄罗斯": "",
		"智利":  "",
		"约旦":  "",
		"土耳其": "",

		// Grammar markers (not domains, skip)
		"前缀":  "", // prefix
		"复":   "", // plural
		"单复同": "", // same singular/plural
		"用作单": "", // used as singular
		"pl.": "", // plural abbreviation
		"微":   "microscopy",
	}
)

func buildPhonetics(ns sql.NullString) []*dictv1.Phonetic {
	if !ns.Valid {
		return nil
	}
	ipa := strings.TrimSpace(ns.String)
	if ipa == "" {
		return nil
	}
	return []*dictv1.Phonetic{{Ipa: ipa, Dialect: "en-US"}}
}

func buildTags(ns sql.NullString) []string {
	if !ns.Valid {
		return nil
	}
	s := strings.TrimSpace(ns.String)
	if s == "" {
		return nil
	}
	s = strings.ReplaceAll(s, ",", " ")
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(parts))
	ordered := make([]string, 0, len(parts))

	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		norm := strings.ToLower(p)
		if _, ok := seen[norm]; ok {
			continue
		}
		seen[norm] = struct{}{}

		// Add appropriate prefix to tags
		tag := p
		if levelTags[norm] {
			tag = "level:" + p
		} else if attrTags[norm] {
			tag = "attr:" + p
		}
		ordered = append(ordered, tag)
	}
	if len(ordered) == 0 {
		return nil
	}
	return ordered
}

func buildSensePayloads(w wordRecord) []sensePayload {
	defLines := splitLines(nullStringVal(w.Definition))
	transLines := splitLines(nullStringVal(w.Translation))
	if len(defLines) == 0 && len(transLines) == 0 {
		return nil
	}

	// Extract POS from the dedicated pos field if available
	// ECDICT uses WordNet format: "n:100", "v:5/n:95", "j:100", etc.
	// where n=noun, v=verb, j=adjective, r=adverb, m=numeral
	// and numbers represent confidence/probability percentages
	var fallbackPOS string
	if w.Pos.Valid && strings.TrimSpace(w.Pos.String) != "" {
		fallbackPOS = parseWordNetPOS(w.Pos.String)
	}

	var results []sensePayload

	results = appendSensePayloads(results, defLines, fallbackPOS, commonv1.Language_LANGUAGE_ENGLISH)
	results = appendSensePayloads(results, transLines, fallbackPOS, commonv1.Language_LANGUAGE_CHINESE)

	return results
}

func appendSensePayloads(results []sensePayload, lines []string, fallbackPOS string, language commonv1.Language) []sensePayload {
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Try to extract POS prefix if present
		pos, rest := tryExtractPOS(line)

		// If no POS found, use fallback and keep entire line as gloss
		if pos == "" {
			pos = fallbackPOS
			rest = line
			// If line starts with domain marker like [人名], [地名], etc. and no POS, treat as proper-noun
			if pos == "" && startsWithDomainMarker(line) {
				pos = "n."
			}
		}

		// Keep the gloss even if it's just domain markers or very short
		results = append(results, sensePayload{
			language:     language,
			partOfSpeech: pos,
			gloss:        rest,
		})
	}

	return results
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, "\n")
	res := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			res = append(res, p)
		}
	}
	return res
}

// startsWithDomainMarker checks if a line starts with a domain marker like [人名], [地名], [法], etc.
func startsWithDomainMarker(line string) bool {
	s := strings.TrimSpace(line)
	if len(s) < 3 {
		return false
	}
	if s[0] != '[' {
		return false
	}
	closeIdx := strings.Index(s, "]")
	return closeIdx > 0 && closeIdx <= 10 // Domain markers are usually short
}

// tryExtractPOS attempts to extract a leading POS tag from a line
// Returns (pos, rest) where rest is the remaining text after POS
// If no POS found, returns ("", "")
// This is a simplified version that doesn't remove domain markers
func tryExtractPOS(line string) (string, string) {
	s := strings.TrimSpace(line)
	if s == "" {
		return "", ""
	}

	lower := strings.ToLower(s)

	for _, cand := range posCandidates {
		if len(lower) < len(cand) {
			continue
		}
		if strings.HasPrefix(lower, cand) {
			rest := s[len(cand):]
			if rest == "" {
				// POS is the entire line, no content
				return normalizePOS(cand), ""
			}
			next := rest[0]
			// POS must be followed by '.', space, or tab
			if next != '.' && next != ' ' && next != '\t' {
				continue
			}
			// Remove the optional '.' and trim space
			rest = strings.TrimSpace(strings.TrimPrefix(rest, "."))
			return normalizePOS(cand), rest
		}
	}
	return "", ""
}

// extractDomainMarkers extracts domain/category markers like [计], [法], [医], etc.
// Returns a slice of domain names (normalized to English)
func extractDomainMarkers(s string) []string {
	var domains []string
	s = strings.TrimSpace(s)

	for {
		// Find patterns like [x], [xx], [xxx] at the beginning
		if len(s) < 3 {
			break
		}
		if s[0] != '[' {
			break
		}
		closeIdx := strings.Index(s, "]")
		if closeIdx == -1 || closeIdx > 10 { // Domain markers are usually short
			break
		}

		// Extract the marker content
		marker := s[1:closeIdx]
		if domain := normalizeDomainMarker(marker); domain != "" {
			domains = append(domains, domain)
		}

		// Move past the marker
		s = strings.TrimSpace(s[closeIdx+1:])
	}

	return domains
}

// normalizeDomainMarker converts Chinese domain markers to English domain names
func normalizeDomainMarker(marker string) string {
	marker = strings.TrimSpace(marker)
	if marker == "" {
		return ""
	}

	// Map common Chinese domain markers to English
	if domain, ok := domainMap[marker]; ok {
		return domain
	}

	// Check if it's already in English and looks like a valid domain
	lower := strings.ToLower(marker)
	// If it contains only ASCII letters, assume it's already English
	if isASCII(marker) {
		return lower
	}

	// Unknown Chinese marker, skip it (return empty to avoid pollution)
	return ""
}

// isASCII checks if a string contains only ASCII characters
func isASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return false
		}
	}
	return true
}

// deduplicateDomains removes duplicate domains while preserving order
func deduplicateDomains(domains []string) []string {
	if len(domains) == 0 {
		return nil
	}

	seen := make(map[string]bool)
	result := make([]string, 0, len(domains))

	for _, domain := range domains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if domain == "" {
			continue
		}
		if !seen[domain] {
			seen[domain] = true
			result = append(result, domain)
		}
	}

	return result
}

// parseWordNetPOS parses ECDICT's WordNet-style POS format
// Examples: "n:100" -> "noun", "v:5/n:95" -> "noun" (takes the highest probability)
// WordNet POS codes: n=noun, v=verb, j=adjective, r=adverb, m=numeral
func parseWordNetPOS(posStr string) string {
	posStr = strings.TrimSpace(posStr)
	if posStr == "" {
		return ""
	}

	// Parse formats like "n:100" or "v:5/n:95"
	// For mixed POS, take the one with highest probability
	var bestPOS string
	var bestProb int

	// Split by slash for mixed POS
	parts := strings.Split(posStr, "/")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		// Split by colon to get pos:probability
		colonIdx := strings.Index(part, ":")
		if colonIdx == -1 {
			// No colon, treat the whole thing as POS
			return wordNetPOSToStandard(part)
		}

		posCode := strings.TrimSpace(part[:colonIdx])
		probStr := strings.TrimSpace(part[colonIdx+1:])

		// Parse probability
		var prob int
		fmt.Sscanf(probStr, "%d", &prob)

		if prob > bestProb {
			bestProb = prob
			bestPOS = posCode
		}
	}

	if bestPOS == "" {
		return ""
	}

	return wordNetPOSToStandard(bestPOS)
}

// wordNetPOSToStandard converts WordNet POS codes to traditional dictionary abbreviations
// Complete WordNet POS codes from ECDICT:
// n=noun, v=verb, j=adjective, r=adverb, m=numeral, s=adjective satellite
// a=article, i=preposition, p=pronoun, d=determiner, u=interjection, c=conjunction
func wordNetPOSToStandard(code string) string {
	code = strings.ToLower(strings.TrimSpace(code))

	switch code {
	case "n":
		return "n."
	case "v":
		return "v."
	case "j", "s": // j=adjective, s=adjective satellite
		return "adj."
	case "r":
		return "adv."
	case "m":
		return "num."
	case "a":
		return "det." // article -> determiner
	case "i":
		return "prep."
	case "p":
		return "pron."
	case "d":
		return "det."
	case "u":
		return "interj."
	case "c":
		return "conj."
	default:
		// If not a WordNet code, try normal normalization
		return normalizePOS(code)
	}
}

// normalizePOS converts POS abbreviations to traditional dictionary abbreviations
// This ensures consistency across Wikidata and ECDICT
func normalizePOS(pos string) string {
	pos = strings.ToLower(strings.TrimSpace(pos))
	pos = strings.TrimSuffix(pos, ".") // Remove trailing period if present

	// Map all variants to traditional dictionary abbreviations
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
	case "art", "article", "det", "determiner":
		return "det."
	case "num", "numeral":
		return "num."
	case "aux", "auxiliary":
		return "aux."
	case "abbr", "abbreviation":
		return "abbr."
	case "pref", "prefix":
		return "prefix"
	case "suf", "suffix":
		return "suffix"
	default:
		return pos
	}
}

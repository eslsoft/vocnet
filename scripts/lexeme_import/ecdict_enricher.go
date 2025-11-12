package main

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"

	_ "github.com/mattn/go-sqlite3"
)

type ecdictEnricher struct {
	mu            sync.Mutex
	entries       map[string]*ecdictEnrichment
	total         int
	applied       int64
	skipped       int64
	missingReport string
}

type ecdictEnrichment struct {
	phonetics  []*dictv1.Phonetic
	categories []string
	domains    []string // domain markers like [计], [法], [医]
	senses     []sensePayload
}

type sensePayload struct {
	language     commonv1.Language
	partOfSpeech string
	gloss        string
}

const maxUncompressedSQLite = 1000 << 20

func newECDICTEnricher(cfg pipelineConfig) (*ecdictEnricher, error) {
	log.Printf("[ecdict] loading enrichment data (url=%s)", cfg.ecdictURL)
	entries, total, err := loadECDICTEntries(cfg)
	if err != nil {
		return nil, err
	}
	log.Printf("[ecdict] ready: %d rows scanned, %d contain enrichment payloads", total, len(entries))
	return &ecdictEnricher{
		entries:       entries,
		total:         total,
		missingReport: cfg.ecdictMissingPath,
	}, nil
}

func (e *ecdictEnricher) Enrich(lexeme *dictv1.Word) {
	if lexeme == nil {
		return
	}
	lemma := strings.ToLower(strings.TrimSpace(lexeme.GetLemma()))
	if lemma == "" {
		return
	}

	e.mu.Lock()
	enrichment, ok := e.entries[lemma]
	if ok {
		delete(e.entries, lemma)
	}
	e.mu.Unlock()
	if !ok {
		atomic.AddInt64(&e.skipped, 1)
		return
	}

	if mergeEnrichment(lexeme, enrichment) {
		atomic.AddInt64(&e.applied, 1)
	} else {
		atomic.AddInt64(&e.skipped, 1)
	}
}

func (e *ecdictEnricher) ReportUnused() {
	if e == nil {
		return
	}
	e.mu.Lock()
	leftover := make([]string, 0, len(e.entries))
	for lemma := range e.entries {
		leftover = append(leftover, lemma)
	}
	e.mu.Unlock()

	log.Printf("[ecdict] applied=%d skipped=%d unused=%d (out of %d)",
		e.applied, e.skipped, len(leftover), e.total)

	if len(leftover) == 0 {
		return
	}

	if e.missingReport == "" {
		sort.Strings(leftover)
		show := leftover
		if len(show) > 10 {
			show = show[:10]
		}
		for _, lemma := range show {
			log.Printf("[ecdict] unused lemma: %s", lemma)
		}
		if len(leftover) > len(show) {
			log.Printf("[ecdict] ... plus %d more (set -ecdict-missing-report to persist)", len(leftover)-len(show))
		}
		return
	}

	path, err := expandHome(e.missingReport)
	if err != nil {
		log.Printf("[ecdict] resolve report path failed: %v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Printf("[ecdict] create report dir failed: %v", err)
		return
	}
	sort.Strings(leftover)
	if err := os.WriteFile(path, []byte(strings.Join(leftover, "\n")), 0o644); err != nil {
		log.Printf("[ecdict] write missing report failed: %v", err)
		return
	}
	log.Printf("[ecdict] wrote %d unused lemmas to %s", len(leftover), path)
}

func loadECDICTEntries(cfg pipelineConfig) (map[string]*ecdictEnrichment, int, error) {
	tmpDir, err := os.MkdirTemp("", "ecdict-*")
	if err != nil {
		return nil, 0, err
	}
	defer os.RemoveAll(tmpDir)

	cacheDir, zipPath, fromCache, err := prepareCachePath(cfg.ecdictURL, cfg.ecdictCacheDir, cfg.ecdictNoCache)
	if err != nil {
		return nil, 0, err
	}
	if !fromCache {
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			return nil, 0, fmt.Errorf("create cache dir: %w", err)
		}
		if err := downloadFile(context.Background(), cfg.ecdictURL, zipPath); err != nil {
			return nil, 0, err
		}
	} else {
		log.Printf("[ecdict] using cached archive %s", zipPath)
	}

	sqlitePath, err := unzipSingle(func(name string) bool {
		return strings.HasSuffix(name, ".db") || strings.HasSuffix(name, ".sqlite")
	}, zipPath, tmpDir)
	if err != nil {
		return nil, 0, err
	}

	db, err := sql.Open("sqlite3", sqlitePath)
	if err != nil {
		return nil, 0, err
	}
	defer db.Close()

	rows, err := db.Query(`SELECT word, phonetic, definition, pos, translation, exchange, tag FROM stardict`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	entries := make(map[string]*ecdictEnrichment, 500000)
	total := 0
	for rows.Next() {
		var r wordRecord
		if err := rows.Scan(&r.Word, &r.Phonetic, &r.Definition, &r.Pos, &r.Translation, &r.Exchange, &r.Tags); err != nil {
			return nil, 0, err
		}
		total++

		r.Word = strings.TrimSpace(r.Word)
		if r.Word == "" || !isSingleWord(r.Word) || isAllEmpty(r) {
			continue
		}
		enrichment := buildEnrichment(r)
		if enrichment.isEmpty() {
			continue
		}
		key := strings.ToLower(r.Word)
		entries[key] = enrichment
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return entries, total, nil
}

func mergeEnrichment(lexeme *dictv1.Word, enrich *ecdictEnrichment) bool {
	if enrich == nil || enrich.isEmpty() {
		return false
	}
	changed := false

	if len(enrich.phonetics) > 0 {
		if addPhonetics(lexeme, enrich.phonetics) {
			changed = true
		}
	}
	if len(enrich.categories) > 0 {
		if addCategories(lexeme, enrich.categories) {
			changed = true
		}
	}
	// Add domain markers as categories with "domain:" prefix
	// Entity types already have "entity:" prefix, don't add "domain:" to them
	if len(enrich.domains) > 0 {
		domainCategories := make([]string, 0, len(enrich.domains))
		for _, domain := range enrich.domains {
			// If domain already has a prefix like "entity:", use it as-is
			if strings.HasPrefix(domain, "entity:") || strings.HasPrefix(domain, "attr:") {
				domainCategories = append(domainCategories, domain)
			} else {
				domainCategories = append(domainCategories, "domain:"+domain)
			}
		}
		if addCategories(lexeme, domainCategories) {
			changed = true
		}
	}
	if len(enrich.senses) > 0 {
		if addSenses(lexeme, enrich.senses) {
			changed = true
		}
	}
	return changed
}

// Helper functions reused from legacy importer --------------------------------

type wordRecord struct {
	Word        string
	Phonetic    sql.NullString
	Definition  sql.NullString
	Pos         sql.NullString
	Translation sql.NullString
	Exchange    sql.NullString
	Tags        sql.NullString
}

func buildEnrichment(r wordRecord) *ecdictEnrichment {
	// Extract domain markers from definition/translation
	var allDomains []string
	if r.Definition.Valid {
		allDomains = append(allDomains, extractDomainMarkers(r.Definition.String)...)
	}
	if r.Translation.Valid {
		allDomains = append(allDomains, extractDomainMarkers(r.Translation.String)...)
	}

	return &ecdictEnrichment{
		phonetics:  buildPhonetics(r.Phonetic),
		categories: buildTags(r.Tags),
		domains:    deduplicateDomains(allDomains),
		senses:     buildSensePayloads(r),
	}
}

func (e *ecdictEnrichment) isEmpty() bool {
	return len(e.phonetics) == 0 && len(e.categories) == 0 && len(e.domains) == 0 && len(e.senses) == 0
}

func addPhonetics(lexeme *dictv1.Word, additions []*dictv1.Phonetic) bool {
	existing := make(map[string]struct{}, len(lexeme.Phonetics))
	for _, p := range lexeme.Phonetics {
		existing[phoneticKey(p)] = struct{}{}
	}
	changed := false
	for _, add := range additions {
		key := phoneticKey(add)
		if _, ok := existing[key]; ok {
			continue
		}
		existing[key] = struct{}{}
		lexeme.Phonetics = append(lexeme.Phonetics, &dictv1.Phonetic{
			Ipa:     strings.TrimSpace(add.GetIpa()),
			Dialect: strings.TrimSpace(add.GetDialect()),
		})
		changed = true
	}
	return changed
}

func addCategories(lexeme *dictv1.Word, categories []string) bool {
	if len(categories) == 0 {
		return false
	}
	existing := make(map[string]struct{}, len(lexeme.Categories))
	for _, cat := range lexeme.Categories {
		existing[strings.ToLower(cat)] = struct{}{}
	}
	changed := false
	for _, cat := range categories {
		norm := strings.ToLower(strings.TrimSpace(cat))
		if norm == "" {
			continue
		}
		if _, ok := existing[norm]; ok {
			continue
		}
		existing[norm] = struct{}{}
		lexeme.Categories = append(lexeme.Categories, cat)
		changed = true
	}
	return changed
}

func addSenses(lexeme *dictv1.Word, additions []sensePayload) bool {
	if len(additions) == 0 {
		return false
	}
	existing := make(map[string]struct{})
	for _, def := range lexeme.GetDefinitions() {
		pos := def.GetPos()
		for _, sense := range def.GetSenses() {
			existing[senseKey(sense.GetLanguage(), pos, sense.GetGloss())] = struct{}{}
		}
	}

	changed := false
	// Allow both Wikidata glosses (English) and ECDICT definitions (English + Chinese)
	// Wikidata glosses are typically brief semantic descriptions
	// ECDICT definitions are more detailed dictionary entries
	// Both have value and should be preserved (deduplicated by exact gloss match)
	for _, add := range additions {
		key := senseKey(add.language, add.partOfSpeech, add.gloss)
		if _, ok := existing[key]; ok {
			continue
		}
		def := ensureDefinition(lexeme, add.partOfSpeech)
		def.Senses = append(def.Senses, &dictv1.LexemeSense{
			Language: add.language,
			Gloss:    add.gloss,
		})
		existing[key] = struct{}{}
		changed = true
	}
	return changed
}

func ensureDefinition(lexeme *dictv1.Word, pos string) *dictv1.Definition {
	pos = strings.TrimSpace(pos)

	// First try exact POS match
	for _, def := range lexeme.GetDefinitions() {
		if strings.EqualFold(strings.TrimSpace(def.GetPos()), pos) {
			return def
		}
	}

	// If no exact match, try fuzzy POS matching
	// ECDICT uses abbreviated forms like "n.", "v.", "adj."
	// Wikidata uses full forms like "noun", "verb", "adjective"
	normalizedPos := normalizePOSForMatching(pos)
	for _, def := range lexeme.GetDefinitions() {
		if normalizePOSForMatching(def.GetPos()) == normalizedPos {
			return def
		}
	}

	// No matching definition found, create a new one
	// New definitions from ECDICT enrichment need a temporary lexeme ID
	// Use "TL" (Temporary Lexeme) prefix with a random suffix for uniqueness
	def := &dictv1.Definition{
		LexemeId: generateTemporaryLexemeID(),
		Pos:      pos,
	}
	lexeme.Definitions = append(lexeme.Definitions, def)
	return def
}

// generateTemporaryLexemeID generates a unique temporary lexeme ID with TL prefix
// Format: TL-{8 hex chars}
// Example: TL-a3f2c9d1
func generateTemporaryLexemeID() string {
	bytes := make([]byte, 4) // 4 bytes = 8 hex chars
	if _, err := rand.Read(bytes); err != nil {
		// Fallback to a simple counter-based approach if random fails
		log.Printf("[ecdict] warning: failed to generate random ID: %v", err)
		return fmt.Sprintf("TL-%08x", atomic.AddInt64(&temporaryLexemeCounter, 1))
	}
	return "TL-" + hex.EncodeToString(bytes)
}

// temporaryLexemeCounter is used as fallback when crypto/rand fails
var temporaryLexemeCounter int64

// normalizePOSForMatching converts POS tags to a normalized form for fuzzy matching
// This should match the logic in normalizePOS() to ensure consistency
func normalizePOSForMatching(pos string) string {
	pos = strings.ToLower(strings.TrimSpace(pos))
	pos = strings.TrimSuffix(pos, ".")

	// Use the same mapping as normalizePOS
	switch pos {
	case "n", "noun":
		return "noun"
	case "v", "verb", "vt", "vi":
		return "verb"
	case "adj", "adjective":
		return "adjective"
	case "adv", "adverb":
		return "adverb"
	case "prep", "preposition":
		return "preposition"
	case "pron", "pronoun":
		return "pronoun"
	case "conj", "conjunction":
		return "conjunction"
	case "interj", "int", "interjection":
		return "interjection"
	case "art", "article":
		return "article"
	case "num", "numeral":
		return "numeral"
	case "aux", "auxiliary":
		return "auxiliary"
	case "abbr", "abbreviation":
		return "abbreviation"
	case "pref", "prefix":
		return "prefix"
	case "suf", "suffix":
		return "suffix"
	default:
		return pos
	}
}

func phoneticKey(p *dictv1.Phonetic) string {
	return strings.ToLower(strings.TrimSpace(p.GetIpa())) + "|" + strings.ToLower(strings.TrimSpace(p.GetDialect()))
}

func senseKey(lang commonv1.Language, pos, gloss string) string {
	return fmt.Sprintf("%d|%s|%s", lang, strings.ToLower(strings.TrimSpace(pos)), strings.ToLower(strings.TrimSpace(gloss)))
}

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

	// Learning level tags that need level: prefix
	levelTags := map[string]bool{
		"gk":    true,
		"cet4":  true,
		"cet6":  true,
		"ky":    true,
		"toefl": true,
		"ielts": true,
		"gre":   true,
		"zk":    true,
	}

	// Attribute tags that need attr: prefix
	attrTags := map[string]bool{
		"phrase": true,
		"saying": true,
	}

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

	// Process English definitions
	for _, line := range defLines {
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
				pos = "proper-noun"
			}
		}

		// Keep the gloss even if it's just domain markers or very short
		// Don't filter out any content
		results = append(results, sensePayload{
			language:     commonv1.Language_LANGUAGE_ENGLISH,
			partOfSpeech: pos,
			gloss:        rest,
		})
	}

	// Process Chinese translations
	for _, line := range transLines {
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
				pos = "proper-noun"
			}
		}

		// Keep the gloss even if it's just domain markers or very short
		// Don't filter out any content
		results = append(results, sensePayload{
			language:     commonv1.Language_LANGUAGE_CHINESE,
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
	// Try common POS abbreviations (ordered by length to match longer ones first)
	candidates := []string{"vt", "vi", "adj", "adv", "prep", "pron", "conj", "interj", "int", "num", "art", "aux", "abbr", "pref", "suf", "noun", "n", "v", "a"}

	for _, cand := range candidates {
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

// removeDomainMarkers removes domain/category markers like [计], [法], [医], etc.
// These markers indicate the domain (computing, law, medicine) but are not part-of-speech tags
func removeDomainMarkers(s string) string {
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
		// Remove the marker and continue
		s = strings.TrimSpace(s[closeIdx+1:])
	}
	return s
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
	domainMap := map[string]string{
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

// wordNetPOSToStandard converts WordNet POS codes to standard full forms
// Complete WordNet POS codes from ECDICT:
// n=noun, v=verb, j=adjective, r=adverb, m=numeral, s=adjective satellite
// a=article, i=preposition, p=pronoun, d=determiner, u=interjection, c=conjunction
func wordNetPOSToStandard(code string) string {
	code = strings.ToLower(strings.TrimSpace(code))

	switch code {
	case "n":
		return "noun"
	case "v":
		return "verb"
	case "j", "s": // j=adjective, s=adjective satellite
		return "adjective"
	case "r":
		return "adverb"
	case "m":
		return "numeral"
	case "a":
		return "article"
	case "i":
		return "preposition"
	case "p":
		return "pronoun"
	case "d":
		return "determiner"
	case "u":
		return "interjection"
	case "c":
		return "conjunction"
	default:
		// If not a WordNet code, try normal normalization
		return normalizePOS(code)
	}
}

// normalizePOS converts POS abbreviations to their canonical full form
// This ensures consistency across Wikidata (uses full forms) and ECDICT (uses abbreviations)
func normalizePOS(pos string) string {
	pos = strings.ToLower(strings.TrimSpace(pos))
	pos = strings.TrimSuffix(pos, ".") // Remove trailing period if present

	// Map all variants to canonical full forms (matching Wikidata's convention)
	switch pos {
	case "n", "noun":
		return "noun"
	case "v", "verb", "vt", "vi":
		return "verb"
	case "a", "adj", "adjective":
		return "adjective"
	case "adv", "adverb":
		return "adverb"
	case "prep", "preposition":
		return "preposition"
	case "pron", "pronoun":
		return "pronoun"
	case "conj", "conjunction":
		return "conjunction"
	case "interj", "int", "interjection":
		return "interjection"
	case "art", "article":
		return "article"
	case "det", "determiner":
		return "determiner"
	case "num", "numeral":
		return "numeral"
	case "aux", "auxiliary":
		return "auxiliary"
	case "abbr", "abbreviation":
		return "abbreviation"
	case "pref", "prefix":
		return "prefix"
	case "suf", "suffix":
		return "suffix"
	default:
		return pos
	}
}

func prepareCachePath(url, cacheDirFlag string, noCache bool) (string, string, bool, error) {
	var base string
	if cacheDirFlag != "" {
		base = cacheDirFlag
	} else {
		userCache, err := os.UserCacheDir()
		if err != nil {
			return "", "", false, fmt.Errorf("get user cache dir: %w", err)
		}
		base = filepath.Join(userCache, "vocnet")
	}
	h := crc32.ChecksumIEEE([]byte(url))
	name := fmt.Sprintf("ecdict-%08x.zip", h)
	zipPath := filepath.Join(base, name)
	if !noCache {
		if st, err := os.Stat(zipPath); err == nil && st.Size() > 0 {
			return base, zipPath, true, nil
		}
	}
	return base, zipPath, false, nil
}

func downloadFile(ctx context.Context, url, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", resp.Status)
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, resp.Body); err != nil {
		return err
	}
	return nil
}

func unzipSingle(match func(string) bool, zipPath, dstDir string) (string, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if match(f.Name) {
			if f.UncompressedSize64 > maxUncompressedSQLite {
				return "", fmt.Errorf("uncompressed size %d exceeds safety limit", f.UncompressedSize64)
			}
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			defer rc.Close()
			outPath := filepath.Join(dstDir, filepath.Base(f.Name))
			out, err := os.Create(outPath)
			if err != nil {
				return "", err
			}
			size, err := safeUint64ToInt64(f.UncompressedSize64)
			if err != nil {
				out.Close()
				return "", err
			}
			written, err := io.CopyN(out, rc, size)
			if err != nil && !errors.Is(err, io.EOF) {
				out.Close()
				return "", err
			}
			if written != size {
				out.Close()
				return "", fmt.Errorf("unexpected truncated copy: wrote %d bytes of %d", written, f.UncompressedSize64)
			}
			out.Close()
			return outPath, nil
		}
	}
	return "", errors.New("sqlite file not found in archive")
}

func safeUint64ToInt64(v uint64) (int64, error) {
	if v > math.MaxInt64 {
		return 0, fmt.Errorf("value %d exceeds int64 capacity", v)
	}
	return int64(v), nil
}

func isSingleWord(w string) bool {
	if strings.ContainsAny(w, " \t\n") {
		return false
	}
	if strings.ContainsAny(w, ",;") {
		return false
	}
	return true
}

func isAllEmpty(r wordRecord) bool {
	return strings.TrimSpace(nullStringVal(r.Phonetic)) == "" &&
		strings.TrimSpace(nullStringVal(r.Definition)) == "" &&
		strings.TrimSpace(nullStringVal(r.Pos)) == "" &&
		strings.TrimSpace(nullStringVal(r.Translation)) == "" &&
		strings.TrimSpace(nullStringVal(r.Exchange)) == ""
}

func nullStringVal(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

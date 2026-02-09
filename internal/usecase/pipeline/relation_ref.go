package pipeline

import (
	"fmt"
	"net/url"
	"strings"
)

func wikidataLexemeRef(externalID string) string {
	id := strings.TrimSpace(externalID)
	if id == "" {
		return ""
	}
	return "wikidata://lexeme/" + id
}

func wordnetSynsetRef(targetID string) string {
	id := strings.TrimSpace(targetID)
	if id == "" {
		return ""
	}
	return "wordnet://synset/" + id
}

func conceptNetTermRef(language, term string) string {
	lang := strings.ToLower(strings.TrimSpace(language))
	if lang == "" {
		lang = "en"
	}
	surface := strings.ToLower(strings.TrimSpace(term))
	if surface == "" {
		return ""
	}
	surface = strings.ReplaceAll(surface, " ", "_")
	return fmt.Sprintf("conceptnet://c/%s/%s", lang, url.PathEscape(surface))
}

func internalLexemeRef(id int64) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("vocnet://lexeme/%d", id)
}

func parseWikidataLexemeRef(ref string) string {
	const prefix = "wikidata://lexeme/"
	if !strings.HasPrefix(ref, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(ref, prefix))
}

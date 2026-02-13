package pipeline

import (
	"fmt"
	"strings"
)

func wikidataLexemeRef(externalID string) string {
	id := strings.TrimSpace(externalID)
	if id == "" {
		return ""
	}
	return "wikidata://lexeme/" + id
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

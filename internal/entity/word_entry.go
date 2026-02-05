package entity

// WordEntry carries lookup context for a lemma and the queried surface term.
type WordEntry struct {
	QueriedTerm string
	Lemma       *Lemma   // The lemma that was found (contains forms and lexeme reference)
	Lexemies    []Lexeme // Associated lexemes with semantic information

	// RelationTargetLemmas resolves LexemeRelation.TargetLexemeID (external lexeme id)
	// to a displayable lemma surface (e.g. "run"). This is lookup context, not
	// canonical domain state.
	RelationTargetLemmas map[string]string
}

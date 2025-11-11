package entity

// WordStatsFilter scopes statistics to specific languages.
type WordStatsFilter struct {
	Languages []Language
}

// WordStats bundles the aggregated data needed for the overview dashboard.
type WordStats struct {
	Summary       WordStatsSummary
	Coverage      WordCoverage
	Languages     []WordLanguageStats
	TopCategories []CategoryStat
	Completeness  []CompletenessBucket
}

// WordStatsSummary surfaces top-line metrics such as totals and recent growth.
type WordStatsSummary struct {
	TotalWords      int64
	TotalLexemes    int64
	TotalForms      int64
	AvgCompleteness float64
	NewLast24h      int64
	NewLast7d       int64
}

// WordCoverage captures the percentage of words that carry a specific attribute.
type WordCoverage struct {
	Phonetics   float64
	Categories  float64
	Definitions float64
	Forms       float64
}

// WordLanguageStats exposes per-language richness and completeness data.
type WordLanguageStats struct {
	Language           Language
	WordCount          int64
	LexemeCount        int64
	AvgCompleteness    float64
	PhoneticCoverage   float64
	DefinitionCoverage float64
	FormCoverage       float64
	CategoryCoverage   float64
}

// CategoryStat summarizes how many lemmas fall under a specific category label.
type CategoryStat struct {
	Category string
	Count    int64
}

// CompletenessBucket is a histogram bucket describing how many words fall
// within a specific completeness score range.
type CompletenessBucket struct {
	Label string
	Min   int32
	Max   int32
	Count int64
}

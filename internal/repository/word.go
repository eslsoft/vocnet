package repository

type ListWordsQuery struct {
	Pagination

	Language     string
	Keyword      string
	Categories   []string
	SurfaceTerms []string
	Levels       []string
	POS          []string
	MinQScore    *float64

	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

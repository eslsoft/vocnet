package repository

type ListWordsQuery struct {
	Pagination

	Language     string
	Keyword      string
	Categories   []string
	SurfaceTerms []string

	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

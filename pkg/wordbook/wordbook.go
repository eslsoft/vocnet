package wordbook

import (
	"embed"
	"encoding/json"

	wordbookv1 "github.com/eslsoft/vocnet/pkg/api/wordbook/v1"
)

var builtinWordbooks = []wordbookv1.Wordbook{
	{
		Id:          101,
		Name:        "CEFR-A1",
		Description: "Common European Framework of Reference for Languages - A1 Level",
		Terms:       readBuiltinWordbookTerms("CEFR-A1"),
	},
	{
		Id:          102,
		Name:        "CEFR-A2",
		Description: "Common European Framework of Reference for Languages - A2 Level",
		Terms:       readBuiltinWordbookTerms("CEFR-A2"),
	},
	{
		Id:          103,
		Name:        "CEFR-B1",
		Description: "Common European Framework of Reference for Languages - B1 Level",
		Terms:       readBuiltinWordbookTerms("CEFR-B1"),
	},
	{
		Id:          104,
		Name:        "CEFR-B2",
		Description: "Common European Framework of Reference for Languages - B2 Level",
		Terms:       readBuiltinWordbookTerms("CEFR-B2"),
	},
	{
		Id:          105,
		Name:        "CEFR-C1",
		Description: "Common European Framework of Reference for Languages - C1 Level",
		Terms:       readBuiltinWordbookTerms("CEFR-C1"),
	},
	{
		Id:          106,
		Name:        "CEFR-C2",
		Description: "Common European Framework of Reference for Languages - C2 Level",
		Terms:       readBuiltinWordbookTerms("CEFR-C2"),
	},
	{
		Id:          107,
		Name:        "Oxford 3000",
		Description: "Oxford 3000 - The most important and useful words to learn in English",
		Terms:       readBuiltinWordbookTerms("Oxford-3000"),
	},
	{
		Id:          108,
		Name:        "Oxford 5000",
		Description: "Oxford 5000 - A list of the 5000 most important words to learn in English",
		Terms:       readBuiltinWordbookTerms("Oxford-5000"),
	},
	{
		Id:          109,
		Name:        "CET4",
		Description: "College English Test Band 4 - A standardized English proficiency test for Chinese college students",
		Terms:       readBuiltinWordbookTerms("CET4"),
	},
	{
		Id:          110,
		Name:        "CET6",
		Description: "College English Test Band 6 - A standardized English proficiency test for Chinese college students",
		Terms:       readBuiltinWordbookTerms("CET6"),
	},
	{
		Id:          111,
		Name:        "GMAT",
		Description: "Graduate Management Admission Test - A standardized test for business school admissions",
		Terms:       readBuiltinWordbookTerms("GMAT"),
	},
	{
		Id:          112,
		Name:        "GRE",
		Description: "Graduate Record Examination - A standardized test for graduate school admissions",
		Terms:       readBuiltinWordbookTerms("GRE"),
	},
	{
		Id:          113,
		Name:        "IELTS",
		Description: "International English Language Testing System - A standardized test to measure English language proficiency",
		Terms:       readBuiltinWordbookTerms("IELTS"),
	},
	{
		Id:          114,
		Name:        "SAT",
		Description: "Scholastic Assessment Test - A standardized test widely used for college admissions in the United States",
		Terms:       readBuiltinWordbookTerms("SAT"),
	},
	{
		Id:          115,
		Name:        "TOEFL",
		Description: "Test of English as a Foreign Language - A standardized test to measure English language proficiency",
		Terms:       readBuiltinWordbookTerms("TOEFL"),
	},
}

//go:embed books/*.json
var builtinWordbookFS embed.FS

func readBuiltinWordbookTerms(name string) []string {
	data, err := builtinWordbookFS.ReadFile("books/" + name + ".json")
	if err != nil {
		panic(err)
	}

	var terms []string
	if err := json.Unmarshal(data, &terms); err != nil {
		panic(err)
	}

	return terms
}

func GetBuiltinWordbooks() []wordbookv1.Wordbook {
	return builtinWordbooks
}

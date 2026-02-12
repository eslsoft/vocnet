package wordbook

import (
	"embed"
	"encoding/json"
)

type Wordbook struct {
	Id          int64
	Name        string
	Description string
	Annotations map[string]string
	Terms       []string
	Language    string
}

var builtinWordbooks = []*Wordbook{
	{
		Id:          101,
		Name:        "CEFR-A1",
		Description: "Common European Framework of Reference for Languages - A1 Level",
		Annotations: map[string]string{
			"icon.emoji":   "🌱",
			"icon.bgColor": "#81D4FA",
		},
		Terms: readBuiltinWordbookTerms("CEFR-A1"),
	},
	{
		Id:          102,
		Name:        "CEFR-A2",
		Description: "Common European Framework of Reference for Languages - A2 Level",
		Annotations: map[string]string{
			"icon.emoji":   "🌿",
			"icon.bgColor": "#B39DDB",
		},
		Terms: readBuiltinWordbookTerms("CEFR-A2"),
	},
	{
		Id:          103,
		Name:        "CEFR-B1",
		Description: "Common European Framework of Reference for Languages - B1 Level",
		Annotations: map[string]string{
			"icon.emoji":   "🌳",
			"icon.bgColor": "#A1887F",
		},
		Terms: readBuiltinWordbookTerms("CEFR-B1"),
	},
	{
		Id:          104,
		Name:        "CEFR-B2",
		Description: "Common European Framework of Reference for Languages - B2 Level",
		Annotations: map[string]string{
			"icon.emoji":   "🏔️",
			"icon.bgColor": "#EF5350",
		},
		Terms: readBuiltinWordbookTerms("CEFR-B2"),
	},
	{
		Id:          105,
		Name:        "CEFR-C1",
		Description: "Common European Framework of Reference for Languages - C1 Level",
		Annotations: map[string]string{
			"icon.emoji":   "🏆",
			"icon.bgColor": "#5C6BC0",
		},
		Terms: readBuiltinWordbookTerms("CEFR-C1"),
	},
	{
		Id:          106,
		Name:        "CEFR-C2",
		Description: "Common European Framework of Reference for Languages - C2 Level",
		Annotations: map[string]string{
			"icon.emoji":   "👑",
			"icon.bgColor": "#9575CD",
		},
		Terms: readBuiltinWordbookTerms("CEFR-C2"),
	},
	{
		Id:          107,
		Name:        "Oxford 3000",
		Description: "Oxford 3000 - The most important and useful words to learn in English",
		Annotations: map[string]string{
			"icon.emoji":   "📘",
			"icon.bgColor": "#F06292",
		},
		Terms: readBuiltinWordbookTerms("Oxford-3000"),
	},
	{
		Id:          108,
		Name:        "Oxford 5000",
		Description: "Oxford 5000 - A list of the 5000 most important words to learn in English",
		Annotations: map[string]string{
			"icon.emoji":   "📕",
			"icon.bgColor": "#4DD0E1",
		},
		Terms: readBuiltinWordbookTerms("Oxford-5000"),
	},
	{
		Id:          109,
		Name:        "CET4",
		Description: "College English Test Band 4 - A standardized English proficiency test for Chinese college students",
		Annotations: map[string]string{
			"icon.emoji":   "🎓",
			"icon.bgColor": "#FFA726",
		},
		Terms: readBuiltinWordbookTerms("CET4"),
	},
	{
		Id:          110,
		Name:        "CET6",
		Description: "College English Test Band 6 - A standardized English proficiency test for Chinese college students",
		Annotations: map[string]string{
			"icon.emoji":   "🎯",
			"icon.bgColor": "#7986CB",
		},
		Terms: readBuiltinWordbookTerms("CET6"),
	},
	{
		Id:          111,
		Name:        "GMAT",
		Description: "Graduate Management Admission Test - A standardized test for business school admissions",
		Annotations: map[string]string{
			"icon.emoji":   "💼",
			"icon.bgColor": "#42A5F5",
		},
		Terms: readBuiltinWordbookTerms("GMAT"),
	},
	{
		Id:          112,
		Name:        "GRE",
		Description: "Graduate Record Examination - A standardized test for graduate school admissions",
		Annotations: map[string]string{
			"icon.emoji":   "🔬",
			"icon.bgColor": "#BA68C8",
		},
		Terms: readBuiltinWordbookTerms("GRE"),
	},
	{
		Id:          113,
		Name:        "IELTS",
		Description: "International English Language Testing System - A standardized test to measure English language proficiency",
		Annotations: map[string]string{
			"icon.emoji":   "🌍",
			"icon.bgColor": "#FFB74D",
		},
		Terms: readBuiltinWordbookTerms("IELTS"),
	},
	{
		Id:          114,
		Name:        "SAT",
		Description: "Scholastic Assessment Test - A standardized test widely used for college admissions in the United States",
		Annotations: map[string]string{
			"icon.emoji":   "🎓",
			"icon.bgColor": "#EC407A",
		},
		Terms: readBuiltinWordbookTerms("SAT"),
	},
	{
		Id:          115,
		Name:        "TOEFL",
		Description: "Test of English as a Foreign Language - A standardized test to measure English language proficiency",
		Annotations: map[string]string{
			"icon.emoji":   "✈️",
			"icon.bgColor": "#FF7043",
		},
		Terms: readBuiltinWordbookTerms("TOEFL"),
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

func GetBuiltinWordbooks() []*Wordbook {
	return builtinWordbooks
}

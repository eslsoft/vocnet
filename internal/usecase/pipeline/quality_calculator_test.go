package pipeline

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/require"
)

func TestQualityScoreCalculator_PenalizesUnresolvedDenseGraph(t *testing.T) {
	calc := NewQualityScoreCalculator()
	rels := make([]entity.SnapshotRelation, 0, 120)
	for i := 0; i < 120; i++ {
		rels = append(rels, entity.SnapshotRelation{
			RelationType: entity.RelationAssociation,
			TargetTerm:   "target",
			Provider:     "conceptnet",
			Strength:     0.8,
			SenseMapped:  false,
		})
	}

	data := entity.SnapshotData{
		Lexemes: []entity.SnapshotLexeme{{
			POS:       "noun",
			Senses:    []entity.SnapshotSense{{Language: "en", Gloss: "x"}},
			Forms:     []entity.SnapshotForm{{Surface: "x", FormType: "LEMMA"}},
			Phonetics: []entity.Phonetic{{IPA: "/x/", Dialect: "en-US"}},
		}},
		Relations: rels,
	}

	score := calc.Calculate(data)
	require.Less(t, score.Overall, 60.0)
	require.Equal(t, 0.0, score.Density)
}

func TestQualityScoreCalculator_RewardsResolvedMappedGraph(t *testing.T) {
	calc := NewQualityScoreCalculator()

	rels := []entity.SnapshotRelation{}
	for i := 0; i < 24; i++ {
		provider := "conceptnet"
		relType := entity.RelationAssociation
		target := "t" + string(rune('a'+(i%12)))
		if i%4 == 0 {
			provider = "wordnet"
			relType = entity.RelationHypernym
			if i == 0 {
				target = "synset:00001740 (entity)"
			}
		}
		rels = append(rels, entity.SnapshotRelation{
			RelationType:   relType,
			TargetTerm:     target,
			Provider:       provider,
			Strength:       0.9,
			SenseMapped:    true,
			TargetResolved: true,
		})
	}

	data := entity.SnapshotData{
		Lexemes: []entity.SnapshotLexeme{
			{
				POS:       "noun",
				Senses:    []entity.SnapshotSense{{Language: "en", Gloss: "a"}},
				Forms:     []entity.SnapshotForm{{Surface: "a", FormType: "LEMMA"}},
				Phonetics: []entity.Phonetic{{IPA: "/a/", Dialect: "en-US"}},
			},
			{
				POS:       "verb",
				Senses:    []entity.SnapshotSense{{Language: "en", Gloss: "b"}},
				Forms:     []entity.SnapshotForm{{Surface: "b", FormType: "LEMMA"}},
				Phonetics: []entity.Phonetic{{IPA: "/b/", Dialect: "en-US"}},
			},
		},
		Relations: rels,
	}

	score := calc.Calculate(data)
	require.Greater(t, score.Overall, 80.0)
	require.Greater(t, score.Density, 40.0)
	require.Greater(t, score.Validity, 80.0)
}

func TestQualityScoreCalculator_PenalizesMissingFormAndPhonetics(t *testing.T) {
	calc := NewQualityScoreCalculator()

	data := entity.SnapshotData{
		Lexemes: []entity.SnapshotLexeme{
			{POS: "noun", Senses: []entity.SnapshotSense{{Language: "en", Gloss: "a"}}},
			{POS: "verb", Senses: []entity.SnapshotSense{{Language: "en", Gloss: "b"}}},
		},
	}

	score := calc.Calculate(data)
	require.Less(t, score.Completeness, 60.0)
}

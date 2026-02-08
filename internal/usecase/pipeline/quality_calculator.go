package pipeline

import "github.com/eslsoft/vocnet/internal/entity"

// QualityScoreCalculator computes multi-dimensional quality scores for word snapshots.
// This extracts the complex scoring logic from Phase 5.
type QualityScoreCalculator struct{}

func NewQualityScoreCalculator() *QualityScoreCalculator {
	return &QualityScoreCalculator{}
}

// Calculate computes a quality score (0-100 scale) across four dimensions.
func (c *QualityScoreCalculator) Calculate(data entity.SnapshotData) entity.QualityScore {
	completeness := c.calculateCompleteness(data)
	depth := c.calculateDepth(data)
	density := c.calculateDensity(data)
	validity := c.calculateValidity(data)

	// Overall: weighted average emphasizing completeness
	overall := (completeness*0.35 + depth*0.25 + density*0.25 + validity*0.15)

	return entity.QualityScore{
		Overall:      overall,
		Completeness: completeness,
		Depth:        depth,
		Density:      density,
		Validity:     validity,
	}
}

// calculateCompleteness measures data presence (0-100).
func (c *QualityScoreCalculator) calculateCompleteness(data entity.SnapshotData) float64 {
	score := 0.0

	// Basic structure (40 points)
	score += c.scoreBasicStructure(data)

	// Senses (30 points)
	score += c.scoreSenses(data)

	// Relations (30 points)
	score += c.scoreRelations(data)

	return score
}

// scoreBasicStructure scores basic lexeme presence.
func (c *QualityScoreCalculator) scoreBasicStructure(data entity.SnapshotData) float64 {
	if len(data.Lexemes) == 0 {
		return 0
	}

	score := 20.0

	// Check if lexemes have meaningful data
	for _, lex := range data.Lexemes {
		if lex.POS != "" {
			score += 10
			break
		}
	}

	// Bonus for multiple lexemes
	if len(data.Lexemes) > 1 {
		score += 10
	}

	return score
}

// scoreSenses scores sense richness.
func (c *QualityScoreCalculator) scoreSenses(data entity.SnapshotData) float64 {
	totalSenses := 0
	for _, lex := range data.Lexemes {
		totalSenses += len(lex.Senses)
	}

	if totalSenses == 0 {
		return 0
	}

	senseScore := float64(totalSenses) * 3
	if senseScore > 30 {
		senseScore = 30
	}

	return senseScore
}

// scoreRelations scores relation presence.
func (c *QualityScoreCalculator) scoreRelations(data entity.SnapshotData) float64 {
	if len(data.Relations) == 0 {
		return 0
	}

	relScore := float64(len(data.Relations)) * 0.3
	if relScore > 30 {
		relScore = 30
	}

	return relScore
}

// calculateDepth measures semantic hierarchy depth (0-100).
// Per design doc: "上位词层级路径完整度，必须确保能追溯至根节点"
func (c *QualityScoreCalculator) calculateDepth(data entity.SnapshotData) float64 {
	// Count WordNet hypernym relations
	hypernymCount := c.countHypernyms(data)

	// If no WordNet data, score is 0 (per design doc requirement)
	if hypernymCount == 0 {
		return 0
	}

	// Score based on hypernym depth:
	// 1 level = 16.7, 3 levels = 50, 6 levels = 100
	score := (float64(hypernymCount) / 6.0) * 100
	if score > 100 {
		score = 100
	}

	// Bonus for examples in senses (up to 10 points)
	if c.hasExamples(data) && score < 100 {
		score += 10
		if score > 100 {
			score = 100
		}
	}

	return score
}

// countHypernyms counts WordNet hypernym relations.
func (c *QualityScoreCalculator) countHypernyms(data entity.SnapshotData) int {
	count := 0
	for _, rel := range data.Relations {
		if rel.Provider == "wordnet" && rel.RelationType == entity.RelationHypernym {
			count++
		}
	}
	return count
}

// hasExamples checks if any sense has examples.
func (c *QualityScoreCalculator) hasExamples(data entity.SnapshotData) bool {
	for _, lex := range data.Lexemes {
		for _, sense := range lex.Senses {
			if len(sense.Examples) > 0 {
				return true
			}
		}
	}
	return false
}

// calculateDensity measures relation network density (0-100).
func (c *QualityScoreCalculator) calculateDensity(data entity.SnapshotData) float64 {
	relationCount := len(data.Relations)

	// Base score by relation count
	var score float64
	switch {
	case relationCount == 0:
		score = 0
	case relationCount <= 10:
		score = 30 // Sparse
	case relationCount <= 30:
		score = 50 // Moderate
	case relationCount <= 50:
		score = 70 // Good
	case relationCount <= 100:
		score = 85 // Very good
	default:
		score = 100 // Excellent
	}

	// Bonus for relation diversity
	if c.hasRelationDiversity(data) && score < 100 {
		score += 10
		if score > 100 {
			score = 100
		}
	}

	return score
}

// hasRelationDiversity checks for 3+ relation types.
func (c *QualityScoreCalculator) hasRelationDiversity(data entity.SnapshotData) bool {
	relationTypes := make(map[string]bool)
	for _, rel := range data.Relations {
		relationTypes[rel.RelationType] = true
	}
	return len(relationTypes) >= 3
}

// calculateValidity measures trust and quality (0-100).
func (c *QualityScoreCalculator) calculateValidity(data entity.SnapshotData) float64 {
	score := 50.0 // Base score

	// Provider diversity bonus
	score += c.scoreProviderDiversity(data)

	// Sense richness bonus
	score += c.scoreSenseRichness(data)

	// Strong relations bonus
	score += c.scoreStrongRelations(data)

	if score > 100 {
		score = 100
	}

	return score
}

// scoreProviderDiversity scores data source diversity.
func (c *QualityScoreCalculator) scoreProviderDiversity(data entity.SnapshotData) float64 {
	providers := make(map[string]bool)
	for _, rel := range data.Relations {
		if rel.Provider != "" {
			providers[rel.Provider] = true
		}
	}

	if len(providers) >= 2 {
		return 20
	} else if len(providers) == 1 {
		return 10
	}

	return 0
}

// scoreSenseRichness scores sense count.
func (c *QualityScoreCalculator) scoreSenseRichness(data entity.SnapshotData) float64 {
	totalSenses := 0
	for _, lex := range data.Lexemes {
		totalSenses += len(lex.Senses)
	}

	if totalSenses > 10 {
		return 15
	} else if totalSenses > 5 {
		return 10
	}

	return 0
}

// scoreStrongRelations scores high-strength relations.
func (c *QualityScoreCalculator) scoreStrongRelations(data entity.SnapshotData) float64 {
	strongCount := 0
	for _, rel := range data.Relations {
		if rel.Strength > 2.0 {
			strongCount++
		}
	}

	if strongCount > 0 {
		return 15
	}

	return 0
}

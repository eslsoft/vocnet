package pipeline

import (
	"math"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

// QualityScoreCalculator computes multi-dimensional quality scores for word snapshots.
//
// Scoring follows the design doc direction:
// - Completeness (C): lexical structure coverage (lemma/lexeme/forms/phonetics)
// - Depth (D): hypernym path depth signal
// - Density (R): effective relation density (after structural quality penalties)
// - Validity (V): consistency/quality signals from relation mapping and source consensus
//
// Overall = 0.35*C + 0.25*D + 0.25*R + 0.15*V
// All dimensions are in [0, 100].
type QualityScoreCalculator struct{}

func NewQualityScoreCalculator() *QualityScoreCalculator {
	return &QualityScoreCalculator{}
}

func (c *QualityScoreCalculator) Calculate(data entity.SnapshotData) entity.QualityScore {
	completeness := c.calculateCompleteness(data)
	depth := c.calculateDepth(data)
	density := c.calculateDensity(data)
	validity := c.calculateValidity(data)

	overall := (completeness * 0.35) + (depth * 0.25) + (density * 0.25) + (validity * 0.15)

	return entity.QualityScore{
		Overall:      clampScore(overall),
		Completeness: clampScore(completeness),
		Depth:        clampScore(depth),
		Density:      clampScore(density),
		Validity:     clampScore(validity),
	}
}

// calculateCompleteness focuses on lexical structure coverage.
func (c *QualityScoreCalculator) calculateCompleteness(data entity.SnapshotData) float64 {
	if len(data.Lexemes) == 0 {
		return 0
	}

	lexemeCount := float64(len(data.Lexemes))
	validPOS := 0
	withSenses := 0
	withForms := 0
	withPhonetics := 0

	for _, lex := range data.Lexemes {
		if isValidPOS(lex.POS) {
			validPOS++
		}
		if len(lex.Senses) > 0 {
			withSenses++
		}
		if len(lex.Forms) > 0 {
			withForms++
		}
		if len(lex.Phonetics) > 0 {
			withPhonetics++
		}
	}

	posCoverage := float64(validPOS) / lexemeCount
	senseCoverage := float64(withSenses) / lexemeCount
	formCoverage := float64(withForms) / lexemeCount
	phoneticCoverage := float64(withPhonetics) / lexemeCount

	// Relation integrity is part of structural completeness:
	// lots of unresolved/unmapped/out-of-range edges should not look "complete".
	relationIntegrity := (0.6 * c.resolvedRelationRatio(data)) +
		(0.2 * c.senseMappedRatio(data)) +
		(0.2 * c.inRangeStrengthRatio(data))

	return (18 * posCoverage) +
		(22 * senseCoverage) +
		(22 * formCoverage) +
		(18 * phoneticCoverage) +
		(20 * relationIntegrity)
}

// calculateDepth measures taxonomy depth via WordNet hypernym signal.
func (c *QualityScoreCalculator) calculateDepth(data entity.SnapshotData) float64 {
	hypernymCount := c.countHypernyms(data)
	if hypernymCount == 0 {
		return 0
	}

	// Design intent: depth should reward a usable taxonomy path and root reachability.
	// We use edge count as path proxy plus a root-hit bonus ("entity" for WordNet noun tree).
	pathCoverage := clampUnit(float64(hypernymCount) / 8.0)
	rootReach := 0.0
	if c.hasHypernymRoot(data) {
		rootReach = 1.0
	}

	score := (70 * pathCoverage) + (30 * rootReach)
	return clampScore(score)
}

// calculateDensity measures effective relation density, not raw edge count.
//
// We penalize relation volume when links are unresolved or mostly not sense-mapped.
func (c *QualityScoreCalculator) calculateDensity(data entity.SnapshotData) float64 {
	uniqueCount := c.countUniqueRelations(data)
	if uniqueCount == 0 {
		return 0
	}

	base := densityBaseScore(uniqueCount)

	resolvedRatio := c.resolvedRelationRatio(data)
	mappedRatio := c.senseMappedRatio(data)

	// Structural quality factor keeps density honest.
	// - Resolved target coverage is dominant (completeness)
	// - Sense mapping improves semantic precision (accuracy)
	qualityFactor := (0.7 * resolvedRatio) + (0.3 * mappedRatio)

	return clampScore(base * qualityFactor)
}

// calculateValidity measures relation trust/consistency quality.
func (c *QualityScoreCalculator) calculateValidity(data entity.SnapshotData) float64 {
	relCount := len(data.Relations)
	if relCount == 0 {
		return 0
	}

	providerDiversity := clampUnit(float64(c.providerCount(data)-1) / 2.0) // 1 provider=0, 3+=1
	mappedRatio := c.senseMappedRatio(data)
	resolvedRatio := c.resolvedRelationRatio(data)
	inRangeStrengthRatio := c.inRangeStrengthRatio(data)
	duplicatePenalty := c.duplicateRatio(data) // higher is worse

	score :=
		(25 * providerDiversity) +
			(25 * mappedRatio) +
			(25 * resolvedRatio) +
			(15 * inRangeStrengthRatio) +
			(10 * (1.0 - duplicatePenalty))

	return clampScore(score)
}

func (c *QualityScoreCalculator) countHypernyms(data entity.SnapshotData) int {
	count := 0
	for _, rel := range data.Relations {
		if rel.Provider == "wordnet" && rel.RelationType == entity.RelationHypernym {
			count++
		}
	}
	return count
}

func (c *QualityScoreCalculator) hasHypernymRoot(data entity.SnapshotData) bool {
	for _, rel := range data.Relations {
		if rel.Provider != "wordnet" || rel.RelationType != entity.RelationHypernym {
			continue
		}
		if strings.Contains(strings.ToLower(rel.TargetTerm), "entity") {
			return true
		}
	}
	return false
}

func (c *QualityScoreCalculator) countUniqueRelations(data entity.SnapshotData) int {
	if len(data.Relations) == 0 {
		return 0
	}
	seen := make(map[string]struct{}, len(data.Relations))
	for _, rel := range data.Relations {
		key := strings.ToLower(strings.TrimSpace(rel.Provider)) + "|" +
			strings.ToUpper(strings.TrimSpace(rel.RelationType)) + "|" +
			strings.ToLower(strings.TrimSpace(rel.TargetTerm))
		seen[key] = struct{}{}
	}
	return len(seen)
}

func (c *QualityScoreCalculator) providerCount(data entity.SnapshotData) int {
	providers := make(map[string]struct{})
	for _, rel := range data.Relations {
		p := strings.TrimSpace(strings.ToLower(rel.Provider))
		if p == "" {
			continue
		}
		providers[p] = struct{}{}
	}
	return len(providers)
}

func (c *QualityScoreCalculator) senseMappedRatio(data entity.SnapshotData) float64 {
	if len(data.Relations) == 0 {
		return 0
	}
	mapped := 0
	for _, rel := range data.Relations {
		if rel.SenseMapped {
			mapped++
		}
	}
	return float64(mapped) / float64(len(data.Relations))
}

func (c *QualityScoreCalculator) resolvedRelationRatio(data entity.SnapshotData) float64 {
	if len(data.Relations) == 0 {
		return 0
	}
	resolved := 0
	for _, rel := range data.Relations {
		if rel.TargetResolved || strings.TrimSpace(rel.TargetRef) != "" {
			resolved++
		}
	}
	return float64(resolved) / float64(len(data.Relations))
}

func (c *QualityScoreCalculator) inRangeStrengthRatio(data entity.SnapshotData) float64 {
	if len(data.Relations) == 0 {
		return 0
	}
	inRange := 0
	for _, rel := range data.Relations {
		if rel.Strength >= 0 && rel.Strength <= 1 {
			inRange++
		}
	}
	return float64(inRange) / float64(len(data.Relations))
}

func (c *QualityScoreCalculator) duplicateRatio(data entity.SnapshotData) float64 {
	if len(data.Relations) == 0 {
		return 0
	}
	seen := make(map[string]struct{}, len(data.Relations))
	duplicates := 0
	for _, rel := range data.Relations {
		key := strings.ToLower(strings.TrimSpace(rel.Provider)) + "|" +
			strings.ToUpper(strings.TrimSpace(rel.RelationType)) + "|" +
			strings.ToLower(strings.TrimSpace(rel.TargetTerm))
		if _, ok := seen[key]; ok {
			duplicates++
			continue
		}
		seen[key] = struct{}{}
	}
	return float64(duplicates) / float64(len(data.Relations))
}

func densityBaseScore(uniqueRelationCount int) float64 {
	switch {
	case uniqueRelationCount == 0:
		return 0
	case uniqueRelationCount <= 10:
		return 30
	case uniqueRelationCount <= 30:
		return 50
	case uniqueRelationCount <= 50:
		return 70
	case uniqueRelationCount <= 100:
		return 85
	default:
		return 100
	}
}

func isValidPOS(pos string) bool {
	parsed, ok := entity.ParsePartOfSpeech(pos)
	return ok && entity.IsValidPartOfSpeech(parsed)
}

func clampUnit(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func clampScore(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

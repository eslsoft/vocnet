# Data Evaluation and Adoption Mechanism

## Overview

This document describes the data evaluation and adoption mechanism that determines which data from multiple sources should be accepted into the pipeline based on quality scoring.

## Problem Statement

Previously, data adoption logic was scattered across individual data sources:

- **ECDICT**: Matched translations by POS from context lexemes → Now returns independent lexemes without POS matching in system
- **Moby**: Looked up syllables for each context form → Now only queries `term`, missing syllables for other forms
- **CEFRJ**: Took minimum of context lemma level and new level → Now `Accumulate` overwrites with `LemmaUpdate` without min logic
- **ConceptNet/WordNet**: Used `source_external_id` from context for relations → Now relations lack `source_external_id`, system doesn't fill it

The system currently adopts data blindly without validating quality or usefulness.

## Design Goals

1. **Centralized Evaluation**: Single authority to decide if data should be adopted
2. **Field-Level Scoring**: Evaluate individual fields based on quality metrics
3. **Extensible Scorers**: Support multiple scoring strategies (rule-based, LLM-based)
4. **Source Trust Hierarchy**: Prefer higher-trust sources when conflicts arise
5. **Empty Field Adoption**: Always adopt data for previously empty fields
6. **Conflict Resolution**: For populated fields, use scoring to pick winner

## Architecture

### Components

```
┌─────────────────────────────────────────────────────┐
│              DataEvaluator                          │
│  - Orchestrates field-level evaluation              │
│  - Applies scoring strategies                       │
│  - Makes adoption decisions                         │
└─────────────────────────────────────────────────────┘
                      │
                      │ uses
                      ▼
┌─────────────────────────────────────────────────────┐
│              FieldScorer (interface)                │
│  - ScoreLexeme(existing, new) → score              │
│  - ScoreForm(existing, new) → score                │
│  - ScoreLemmaField(field, existing, new) → score   │
│  - ScoreRelation(existing, new) → score            │
└─────────────────────────────────────────────────────┘
                      △
                      │ implements
         ┌────────────┴────────────┐
         │                         │
┌────────────────┐      ┌──────────────────┐
│  RuleBasedScorer│      │  LLMFieldScorer  │
│  (built-in)     │      │  (future)        │
└────────────────┘      └──────────────────┘
```

### Data Flow

1. **ProcessResult → Evaluator**: Each processor result passes through evaluator
2. **Field Extraction**: Evaluator extracts comparable fields (lexemes, forms, lemma metadata)
3. **Scoring**: For each field, compute quality score using FieldScorer
4. **Decision**: Adopt if:
   - Existing field is empty/missing → Always adopt
   - New score > existing score → Replace
   - New score == existing score → Use source trust rank as tiebreaker
   - New score < existing score → Reject
5. **Accumulation**: Only adopted data flows into PipelineContext

## Scoring Strategies

### RuleBasedScorer (Initial Implementation)

**Lexeme Scoring** (0-100):
- Base: 40 points
- +20 if valid POS (not "unspecified")
- +20 if has senses (glosses/definitions)
- +10 if has categories
- +10 if has ExternalID (Wikidata L-number preferred)

**Form Scoring** (0-100):
- Base: 50 points
- +25 if has phonetics
- +25 if has syllables

**Lemma Field Scoring** (0-100):
- **Level**: Prefer lower CEFR level (higher proficiency requirement = better quality)
  - Map level to score: A1=100, A2=90, B1=80, B2=70, C1=60, C2=50, Unknown=0
- **Frequencies**: Count of corpus entries * 10 (capped at 100)
- **Syllables**: 100 if present, 0 if absent

**Relation Scoring** (0-100):
- Base: 30 points
- +30 if target is resolved (has TargetLexemeID or valid TargetRef)
- +20 if sense-mapped
- +20 if strength is in valid range [0, 1]

**Source Trust Hierarchy** (tiebreaker):
1. Wikidata (rank 5)
2. WordNet (rank 4)
3. LLM (rank 3)
4. ECDICT (rank 2)
5. ConceptNet (rank 1)
6. Others (rank 0)

### LLMFieldScorer (Future)

Future extension that uses LLM to score field quality based on semantic context:
- Input: existing data, new data, context (term, language, existing lexemes)
- Output: quality score + confidence + reasoning
- Useful for nuanced decisions like sense disambiguation, translation quality

## Implementation

### Phase 1: Core Infrastructure

1. **FieldScorer Interface** (`field_scorer.go`)
2. **RuleBasedScorer** (`rule_based_scorer.go`)
3. **DataEvaluator** (`data_evaluator.go`)
4. **Integration** into `PipelineContext.Accumulate()`

### Phase 2: Enhanced Source Metadata

Update sources to include metadata for scoring:
- Provider name in all entities
- Timestamp for freshness scoring (future)
- Confidence scores from external sources (future)

### Phase 3: LLM Scorer (Optional)

Implement LLMFieldScorer for advanced semantic evaluation.

## Examples

### Example 1: CEFRJ Level Adoption

**Existing**: `Lemma.Level = "B1"`
**New**: `Lemma.Level = "A2"` (from CEFRJ)

**Scoring**:
- Existing score: 80 (B1 level)
- New score: 90 (A2 level, more fundamental)

**Decision**: Adopt A2 (new score > existing score)

### Example 2: Moby Syllables for Forms

**Existing**: `Forms = [{Surface: "running", FormType: "gerund", Syllables: []}]`
**New**: `Forms = [{Surface: "running", Syllables: ["run", "ning"]}]`

**Scoring**:
- Existing score: 50 (no syllables)
- New score: 75 (has syllables)

**Decision**: Adopt syllables (merge into existing form)

### Example 3: ECDICT Lexeme vs Wikidata

**Existing**: `Lexeme{ExternalID: "L123", POS: "noun", Senses: [...]}` (Wikidata)
**New**: `Lexeme{POS: "noun", Senses: [...]}` (ECDICT, no ExternalID)

**Scoring**:
- Existing score: 90 (has ExternalID + senses + valid POS)
- New score: 80 (no ExternalID)

**Decision**: Keep existing Wikidata lexeme

## Migration Notes

### Backward Compatibility

- Existing pipeline stages continue to work unchanged
- Evaluator is opt-in initially via feature flag
- Gradual rollout with A/B testing against old behavior

### Performance Considerations

- Scoring is O(n) for each field type, acceptable for current scale
- LLM scorer adds latency; use caching and batch processing
- Evidence storage tracks adoption decisions for debugging

## Testing Strategy

1. **Unit Tests**: Each scorer implementation independently
2. **Integration Tests**: Full pipeline with multiple conflicting sources
3. **Golden Data Tests**: Known-good vocabulary items with expected outcomes
4. **Performance Benchmarks**: Ensure scoring overhead < 5% of total pipeline time

## References

- Pipeline Quality Score: `quality_calculator.go` (inspiration for scoring dimensions)
- Source Provider Trust: `persistence.go:providerTrustRank()` (existing trust hierarchy)
- Relation Deduplication: `persistence.go:deduplicateRelations()` (existing merge logic)

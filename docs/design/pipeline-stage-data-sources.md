# Pipeline Phase Data Sources Matrix

This document describes the new fragment-based pipeline architecture and which data sources contribute to each phase.

## Architecture Overview

The pipeline follows a data engineering approach with four phases:

```
Collection → Evaluation → Integration → Snapshot
```

### Phase Descriptions

1. **Collection (PhaseCollection)**: Concurrent data acquisition from all sources with contract validation
2. **Evaluation (PhaseEvaluation)**: Quality scoring of data fragments from each source
3. **Integration (PhaseIntegration)**: Field-level merging based on quality scores
4. **Snapshot (PhaseSnapshot)**: Final materialized snapshot generation

### Data Source Types

Sources are categorized as:

- **Built-in** (`SourceKindBuiltin`): Compiled into the binary
  - Wikidata (lexemes, forms, phonetics)
  - Moby (syllable data)
  - CEFR-J (vocabulary levels)
- **Contrib** (`SourceKindContrib`): External processes communicating via JSON-RPC over stdio
  - ECDICT (lexical enrichment, Python)
  - ConceptNet (semantic relations, Python)
  - WordNet (semantic relations, Python)
- **Specialized processors**: Not SourceProvider-based; contain unique business logic
  - CategoryInfer (infer categories from senses)
  - FragmentEvaluator (quality scoring)
  - IntegrationProcessor (field-level merging)
  - SnapshotProcessor (final snapshot generation)

### Wiring

Stage wiring source: `cmd/serve.go` (`buildNewPipelineStages`)

1. Built-in SourceProviders are registered in a `SourceRegistry`
2. Contrib sources are discovered from `PIPELINE_CONTRIB_DIR` + `PIPELINE_CONTRIB_LIST`
3. Stages are manually constructed with explicit phase and processors
4. Collection phase runs concurrently with all data sources

### Partial Data Contract System

**Key Principle**: Data sources provide partial data, but what they provide must be standardized.

Contract validator (`internal/usecase/pipeline/contract.go`) enforces:
- **Lexeme**: PartOfSpeech cannot be Unspecified; Senses must be non-empty
- **Form**: Phonetics.IPA must be valid format; Dialect must be ISO 639 (e.g., `en-US` not `US`)
- **Relation**: Strength must be in [0, 1]; TargetRef must be valid URI

Non-compliant data is immediately rejected with `ContractViolationError`.

## Phase 1: Collection

All data sources run concurrently in this phase. Each source returns partial data fragments that undergo contract validation.

### Processor: `wikidata` (`NewWikidataProcessor`) [specialized]

- Data source: Wikidata local lexeme index (`internal/adapter/provider/wikidata`)
- Input query: `FetchLexemes(term, language)`
- Extracted data:
  - Lexeme-level:
    - `ExternalID` (`LexemeID`, e.g. `L123`)
    - `Language`
    - `PartOfSpeech` (mapped to internal enum `entity.PartOfSpeech`)
    - `Senses` (from `sense.Glosses` language map)
    - `SenseGloss` (picked from senses)
    - `Categories` (inferred from senses)
  - Form-level:
    - `Surface` (form representation)
    - `FormType` (mapped from Wikidata grammatical feature QIDs)
    - `IsIrregular`
    - `Phonetics` (`IPA`, `Dialect`)
  - Global form behavior:
    - Ensures the queried surface form is present as a lemma form (`ensureSurfaceForm`)
  - Evidence:
    - `Provider=wikidata`, `Phase=collection`
    - `Content=rawResp` from provider
    - `SchemaVersion=wikidata-2025`
- Contract validation:
  - Rejects low-confidence multi-candidate matches (`match_score <= 40` and `candidate_count > 1`)
  - Rejects unmapped/unknown POS (including unknown Wikidata POS QIDs)

### Processor: `category-infer` (`NewCategoryInferProcessor`) [specialized]

- Data source: None (derived from already collected lexeme senses)
- Extracted/derived data:
  - Additional `Lexeme.Categories` from `InferCategoriesFromSenses`
- Evidence: None (no external fetch)

### Processor: `wikidata_relations` (`NewWikidataRelationProcessor`) [specialized]

- Data source: Wikidata form lookup (`FetchLexemesByForm`)
- Input query:
  - Candidate lookup terms from: requested term + known forms (max 8, deduped)
- Extracted data:
  - Cross-lexeme neighborhood relations:
    - `RelationType=ASSOCIATION`
    - `TargetRef=wikidata://lexeme/{LexemeID}`
    - `TargetTerm` (best form surface or fallback)
    - `Provider=wikidata`
    - `Strength=0.9`
    - `SenseMapped=true`
  - Evidence content:
    - `source=wikidata-lexeme-neighborhood`
    - `term`, `language`, `lookup_terms`, `lookup_terms_queried`, `relations_found`
    - `SchemaVersion=wikidata-relations-v1`
- Contract validation:
  - Only keeps targets already present in current context lexeme IDs (avoid noisy expansion)

### Source: `cefrj` (built-in SourceProvider)

- Adapter: `internal/adapter/provider/cefrj/source_provider.go`
- Data source: CEFR-J CSVs (`internal/adapter/provider/cefrj`)
  - Base: `cefrj-vocabulary-profile-1.5.csv`
  - Supplement: `octanove-vocabulary-profile-c1c2-1.0.csv`
- Capabilities: `metadata`
- Input query: lookup by term (case-insensitive; CEFR-J headword variants split by `/`)
- Extracted data:
  - Lemma enrichment:
    - `Lemma.Level` (CEFR level)
    - Rule: when multiple CEFR-J rows match a lemma, choose the minimum CEFR level by order `A1 < A2 < B1 < B2 < C1 < C2`
  - Evidence content fields:
    - `headword`, `min_level`, `levels_by_pos`, `matched_forms`
    - `Provider=cefrj`, `Phase=collection`, `SchemaVersion=cefrj-1.5+c1c2-1.0`

### Source: `moby` (built-in SourceProvider)

- Adapter: `internal/adapter/provider/moby/source_provider.go`
- Data source: Moby hyphenation file (`internal/adapter/provider/moby`)
- Capabilities: `forms`
- Input query: lookup each existing form surface
- Extracted data:
  - `LemmaForm.Syllables`
- Evidence: None (no raw evidence record emitted)

### Source: `ecdict` (contrib, Python: `contrib/sources/ecdict.py`)

- Data source: ECDICT SQLite (`data/datasources/ecdict/ecdict.db`)
- Capabilities: `enrichment`, `forms`, `metadata`
- Input query: `Lookup(term)` via SQL
- Extracted data:
  - Lexeme enrichment:
    - `Senses` from `translation` -> Chinese senses (POS-grouped)
    - `Categories` from `tags` (domain categories)
    - `Completeness` (scored from available fields)
  - Lemma enrichment:
    - `Frequencies`:
      - `bnc` -> corpus `bnc`
      - `frq` -> corpus `frq`
  - Form enrichment:
    - Lemma form phonetic from `phonetic` (dialect hardcoded to `en-GB`)
  - Evidence content fields:
    - `word`, `phonetic`, `definition`, `translation`, `pos`, `tags`
    - `bnc`, `frq`, `collins`, `oxford`, `exchange`
    - `Provider=ecdict`, `Phase=collection`, `SchemaVersion=ecdict-1.0`

### Source: `conceptnet` (contrib, Python: `contrib/sources/conceptnet.py`)

- Data source: ConceptNet SQLite index (`data/datasources/conceptnet/conceptnet-assertions-5.7.0.csv.idx.db`)
- Capabilities: `relations`
- Input query: query edges by concept URI `/c/{lang}/{term}`
- Extracted data:
  - Semantic relations (`entity.SemanticRelation`):
    - `RelationType` (mapped from ConceptNet labels: Synonym, Antonym, IsA, etc.)
    - `TargetTerm` (opposite side of current term in edge)
    - `TargetRef` (`conceptnet://c/{lang}/{term}`)
    - `Provider=conceptnet`
    - `Strength` (normalized: `weight / (weight + 1)`)
    - `SenseMapped=false` (for later mapping)
  - Evidence:
    - `Provider=conceptnet`, `Phase=collection`
    - `SchemaVersion=conceptnet-5.7`
- Contract validation:
  - Drops low-signal edges where `weight <= 1.0`
  - Skips cross-language edges

### Source: `wordnet` (contrib, Python: `contrib/sources/wordnet.py`)

- Data source: WordNet 3.1 dict files (`data/datasources/wordnet/`)
- Capabilities: `relations`
- Input query:
  - POS candidates from current lexemes (plus fallback noun/verb/adjective/adverb)
  - Synset lookup by word + POS, then hypernym traversal
- Extracted data:
  - Semantic relations:
    - Hypernym chain relations:
      - `RelationType=HYPERNYM`
      - `TargetRef=wordnet://synset/{offset}`
      - `Provider=wordnet`, `Strength=1.0`, `SenseMapped=true`
    - Other mapped pointer-symbol relations (via WordNet symbol mapping)
  - Evidence content:
    - `word`, `pos_candidates`
    - `synsets`: `{offset,pos,words,gloss,relations}`
    - `SchemaVersion=wordnet-3.1`

## Phase 2: Evaluation

This phase evaluates the quality of data fragments collected from each source.

### Processor: `fragment_evaluator` (`NewFragmentEvaluator`)

- Implementation: `internal/usecase/pipeline/fragment_evaluator.go`
- Data source: None (evaluates fragments in `PipelineContext`)
- Scoring engine: `RuleBasedScorer` (`internal/usecase/pipeline/rule_based_scorer.go`)
- Process:
  1. Groups evidence by provider
  2. For each provider, evaluates:
     - Lexemes (POS validity, senses, categories, ExternalID)
     - Forms (phonetics, syllables)
     - Lemma metadata (level, frequencies, syllables)
     - Relations (target resolution, strength validity)
  3. Stores evaluated fragments in `PipelineContext.EvaluatedFragments`
- Output structure:
  ```go
  type FieldFragment struct {
      Type     string     // "lexeme", "form.phonetics", "metadata.level"
      Data     any        // Actual data
      Score    FieldScore // Quality assessment (0-100 scale)
      Provider string     // Data source name
  }
  ```
- Key insight: Each field is scored independently, enabling field-level merging in Integration phase

## Phase 3: Integration

This phase performs smart field-level merging based on quality scores.

### Processor: `integration` (`NewIntegrationProcessor`)

- Implementation: `internal/usecase/pipeline/proc_integration.go`
- Data source: None (merges fragments from `PipelineContext.EvaluatedFragments`)
- Process:
  1. Groups fragments by field key (e.g., `form:run:phonetics`, `metadata:level`)
  2. For each field, sorts candidates by score descending
  3. Selects the highest-scoring fragment
  4. Merges into integrated data structures
  5. Records data provenance for each field
- Output:
  - Updated `PipelineContext.Lexemes`, `Forms`, `Relations`, `Lemma`
  - Provenance tracking:
    ```go
    type DataProvenance struct {
        Provider     string     // Which provider supplied this data
        Score        FieldScore // Quality score
        Timestamp    time.Time  // When it was integrated
        Alternatives int        // How many candidates were rejected
    }
    ```
- Key benefit: Automatically selects best data at field granularity, not entity granularity

## Phase 4: Snapshot

This phase generates the final materialized snapshot.

### Processor: `snapshot` (`NewSnapshotProcessor`)

- Data source: None (pure synthesis from `PipelineContext`)
- Extracted/derived data:
  - Builds materialized `WordSnapshot`:
    - Snapshot lexemes (`POS`, senses, forms, phonetics)
    - Snapshot relations (type/target/provider/strength/mapped/resolved)
    - Quality scores (`QScore`, completeness/depth/density/validity)
- Evidence: None (snapshot entity is emitted, not raw evidence)

## Source-to-Phase Quick Matrix

| Source | Type | Collection | Evaluation | Integration | Snapshot |
|---|---|---|---|---|---|
| Wikidata | builtin (specialized) | ✅ | ❌ | ❌ | ❌ |
| CategoryInfer | specialized | ✅ | ❌ | ❌ | ❌ |
| WikidataRelations | specialized | ✅ | ❌ | ❌ | ❌ |
| CEFR-J | builtin (SourceProvider) | ✅ | ❌ | ❌ | ❌ |
| Moby | builtin (SourceProvider) | ✅ | ❌ | ❌ | ❌ |
| ECDICT | contrib (Python) | ✅ | ❌ | ❌ | ❌ |
| ConceptNet | contrib (Python) | ✅ | ❌ | ❌ | ❌ |
| WordNet | contrib (Python) | ✅ | ❌ | ❌ | ❌ |
| FragmentEvaluator | specialized | ❌ | ✅ | ❌ | ❌ |
| IntegrationProcessor | specialized | ❌ | ❌ | ✅ | ❌ |
| SnapshotProcessor | specialized | ❌ | ❌ | ❌ | ✅ |

Note: All data sources run concurrently in Collection phase.

## Configuration

### Built-in sources

Managed via `PIPELINE_DATA_DIR` (default: `./data`). Auto-download via `PIPELINE_AUTO_DOWNLOAD=true`.

### Contrib sources

```bash
# Directory containing contrib source scripts
PIPELINE_CONTRIB_DIR=./contrib/sources

# Comma-separated list of enabled contrib sources
PIPELINE_CONTRIB_LIST=ecdict,conceptnet,wordnet
```

Each contrib source is a script in `PIPELINE_CONTRIB_DIR` that implements the JSON-RPC protocol.
The `PIPELINE_DATA_DIR` environment variable is inherited by child processes.

## Key Design Decisions

### Why Fragment-Based Evaluation?

Each data source returns partial data. Multiple sources may provide the same field (e.g., phonetics from both Wikidata and ECDICT). The fragment-based approach:

1. **Evaluates each field independently**: A source may provide high-quality phonetics but low-quality senses
2. **Enables field-level merging**: Integration can select Wikidata's phonetics and ECDICT's senses
3. **Records provenance**: We know which provider supplied each field and why (quality score)

### Why Contract Validation?

Instead of adapting to dirty data, we push the responsibility to data sources:

- **Standardized formats**: IPA must be valid, Dialect must be ISO 639
- **No unspecified values**: PartOfSpeech cannot be `unspecified`
- **Valid ranges**: Relation strength must be [0, 1]

Non-compliant data is rejected immediately with detailed violation reports for debugging.

### Why Concurrent Collection?

Data sources are independent. Running them concurrently:

- **Reduces latency**: Total time = max(source latency), not sum(source latency)
- **Simplifies logic**: No inter-source dependencies to manage
- **Enables parallel evaluation**: Fragment evaluation can also be parallelized per-provider

## Update Rule (Must Keep in Sync)

When any of the following changes, update this document in the same PR:

- Phase order or phase membership in `cmd/serve.go`
- Added/removed/replaced processor in any phase
- SourceProvider interface or contrib protocol changes
- Processor extraction fields, filters, scoring/mapping rules
- Contract validation rules or `SchemaVersion`
- Data source provider API changes affecting extracted outputs

Recommended PR checklist item:

- [ ] Updated `docs/design/pipeline-stage-data-sources.md` to match pipeline behavior

# Pipeline Stage Data Sources Matrix

This document describes, stage by stage, which data source each processor uses and what data it extracts into the pipeline context.

## Architecture Overview

The pipeline uses a unified `SourceProvider` interface (`internal/repository/source_provider.go`) for all data sources. Sources are categorized as:

- **Built-in** (`SourceKindBuiltin`): Compiled into the binary, registered via `SourceRegistry` in `cmd/serve.go`
  - Wikidata (specialized processors due to complex discovery logic)
  - Moby (syllable data)
  - CEFR-J (vocabulary levels)
- **Contrib** (`SourceKindContrib`): External processes communicating via JSON-RPC over stdio (`contrib/sources/`)
  - ECDICT (lexical enrichment, Python)
  - ConceptNet (semantic relations, Python)
  - WordNet (semantic relations, Python)
- **Specialized processors**: Not SourceProvider-based; contain unique business logic
  - CategoryInfer, SenseMapping, Enrichment, Scoring, Snapshot

### Wiring

Stage wiring source: `cmd/serve.go` (`buildPipelineWorkerPool`)

1. Built-in SourceProviders are registered in a `SourceRegistry`
2. Contrib sources are discovered from `PIPELINE_CONTRIB_DIR` + `PIPELINE_CONTRIB_LIST`
3. `SourceRegistry.BuildStages()` auto-groups sources by stage and wraps them in `GenericSourceProcessor`
4. Specialized processors are injected separately via the `specialProcessors` map

### Contrib Protocol

External sources implement JSON-RPC 2.0 over stdin/stdout with three methods:
- `initialize` → returns manifest (name, version, capabilities, stage, languages)
- `lookup` → term/language/context → `SourceResult` as JSON
- `shutdown` → graceful stop

Protocol types: `internal/adapter/provider/contrib/protocol.go`

## Scope and Source of Truth

- Stage wiring source: `cmd/serve.go` (`buildPipelineWorkerPool`)
- Unified interface: `internal/repository/source_provider.go`
- Generic processor: `internal/usecase/pipeline/generic_processor.go`
- Source registry: `internal/usecase/pipeline/source_registry.go`
- Contrib bridge: `internal/adapter/provider/contrib/process_provider.go`
- This document reflects the current runtime pipeline order:
  1. `discovery`
  2. `lexical`
  3. `relational`
  4. `intellectual`
  5. `synthesis`

## Stage 1: Discovery

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
    - `Provider=wikidata`, `Phase=discovery`
    - `Content=rawResp` from provider
    - `SchemaVersion=wikidata-2025`
- Key quality gate:
  - Rejects low-confidence multi-candidate matches (`match_score <= 40` and `candidate_count > 1`)
  - Rejects unmapped/unknown POS (including unknown Wikidata POS QIDs)

### Processor: `category-infer` (`NewCategoryInferProcessor`) [specialized]

- Data source: None (derived from already collected lexeme senses)
- Extracted/derived data:
  - Additional `Lexeme.Categories` from `InferCategoriesFromSenses`
- Evidence:
  - None (no external fetch)

## Stage 2: Lexical

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
    - If lemma already has a level, processor keeps the lower one between existing and CEFR-J
  - Evidence content fields:
    - `headword`, `min_level`, `levels_by_pos`, `matched_forms`
    - `Provider=cefrj`, `Phase=lexical`, `SchemaVersion=cefrj-1.5+c1c2-1.0`

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
    - `Provider=ecdict`, `Phase=lexical`, `SchemaVersion=ecdict-1.0`

### Source: `moby` (built-in SourceProvider)

- Adapter: `internal/adapter/provider/moby/source_provider.go`
- Data source: Moby hyphenation file (`internal/adapter/provider/moby`)
- Capabilities: `forms`
- Input query: lookup each existing form surface
- Extracted data:
  - `LemmaForm.Syllables`
- Evidence:
  - None (no raw evidence record emitted)

## Stage 3: Relational

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
    - `Provider=conceptnet`, `Phase=relational`
    - `SchemaVersion=conceptnet-5.7`
- Key filter:
  - Drops low-signal edges where `weight <= 1.0`
  - Skips cross-language edges

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
- Key constraint:
  - Only keeps targets already present in current context lexeme IDs (avoid noisy expansion)

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

## Stage 4: Intellectual

This stage uses the LLM provider (`internal/adapter/provider/llm`), not offline lexical databases.

### Processor: `sense_mapping` (`NewSenseMappingProcessor`) [specialized]

- Data source: LLM completion (`JSONMode`)
- Input payload:
  - Unmapped relations (`SenseMapped=false`)
  - Current lexeme summaries (`external_id`, `pos`, `sense_gloss`)
- Extracted/updated data:
  - In-place updates of existing relations:
    - set `SourceExternalID` to mapped lexeme ID
    - set `SenseMapped=true`
  - Evidence:
    - `processor=sense_mapping`, `model=llm`, `cached`, `token_count`, `mapped_count`
    - `Provider=llm`, `Phase=intellectual`

### Processor: `enrichment` (`NewEnrichmentProcessor`) [specialized]

- Data source: LLM completion (`JSONMode`)
- Input payload:
  - Incomplete lexemes (missing gloss/senses/examples)
- Extracted/updated data:
  - Lexeme updates:
    - fill `SenseGloss` if empty
    - merge new `Senses` (English/Chinese and examples)
  - Evidence:
    - `processor=enrichment`, `model=llm`, `cached`, `token_count`, `enriched_count`
    - `Provider=llm`, `Phase=intellectual`

### Processor: `scoring` (`NewScoringProcessor`) [specialized]

- Data source: LLM completion (`JSONMode`)
- Input payload:
  - Current relations (`target_term`, `relation_type`, `provider`, `current_strength`)
- Extracted/updated data:
  - In-place relation strength updates:
    - set `Strength` to LLM score clamped to `[0,1]`
  - Evidence:
    - `processor=scoring`, `model=llm`, `cached`, `token_count`, `scored_count`
    - `Provider=llm`, `Phase=intellectual`

## Stage 5: Synthesis

### Processor: `snapshot` (`NewSnapshotProcessor`) [specialized]

- Data source: None (pure synthesis from `PipelineContext`)
- Extracted/derived data:
  - Builds materialized `WordSnapshot`:
    - Snapshot lexemes (`POS`, senses, forms, phonetics)
    - Snapshot relations (type/target/provider/strength/mapped/resolved)
    - Quality scores (`QScore`, completeness/depth/density/validity)
- Evidence:
  - None (snapshot entity is emitted, not raw evidence)

## Cross-Stage POS Validation

- Pipeline performs strict POS validation on `PipelineContext.Lexemes`.
- Any lexeme with POS outside internal enum `entity.PartOfSpeech` fails the pipeline run.
- This serves as a future-proof guardrail so newly introduced data-source POS values cannot silently pass through.

## Source-to-Stage Quick Matrix

| Source | Type | Discovery | Lexical | Relational | Intellectual | Synthesis |
|---|---|---|---|---|---|---|
| Wikidata | builtin (specialized) | ✅ | ❌ | ✅ | ❌ | ❌ |
| CEFR-J | builtin (SourceProvider) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Moby | builtin (SourceProvider) | ❌ | ✅ | ❌ | ❌ | ❌ |
| ECDICT | contrib (Python) | ❌ | ✅ | ❌ | ❌ | ❌ |
| ConceptNet | contrib (Python) | ❌ | ❌ | ✅ | ❌ | ❌ |
| WordNet | contrib (Python) | ❌ | ❌ | ✅ | ❌ | ❌ |
| LLM | specialized | ❌ | ❌ | ❌ | ✅ | ❌ |
| Internal context only | specialized | ✅ | ❌ | ❌ | ❌ | ✅ |

`✅` details:
- Wikidata: discovery=`wikidata`; relational=`wikidata_relations`
- CEFR-J: lexical=`cefrj` (SourceProvider)
- Moby: lexical=`moby` (SourceProvider)
- ECDICT: lexical=`ecdict` (contrib)
- ConceptNet: relational=`conceptnet` (contrib)
- WordNet: relational=`wordnet` (contrib)
- LLM: intellectual=`sense_mapping`, `enrichment`, `scoring`
- Internal context only: discovery=`category-infer`; synthesis=`snapshot`

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

## Update Rule (Must Keep in Sync)

When any of the following changes, update this document in the same PR:

- Stage order or stage membership in `cmd/serve.go`
- Added/removed/replaced processor in any stage
- SourceProvider interface or contrib protocol changes
- Processor extraction fields, filters, scoring/mapping rules
- Raw evidence payload structure or `SchemaVersion`
- Data source provider API changes affecting extracted outputs

Recommended PR checklist item:

- [ ] Updated `docs/design/pipeline-stage-data-sources.md` to match pipeline behavior

# ListWords API - Filtering and Querying

## Overview

The `ListWords` API uses a unified CEL (Common Expression Language) based filtering approach for maximum flexibility and consistency across all List APIs.

## API Definition

```protobuf
message ListWordsRequest {
  string filter = 1;      // CEL expression for filtering
  string order_by = 2;    // Sorting specification
  common.v1.PaginationRequest pagination = 3;
}
```

## Filter Fields

The following fields are available for filtering:

| Field | Type | Operators | Description |
|-------|------|-----------|-------------|
| `language` | string | `==`, `!=` | ISO 639-1 language code (e.g., "en", "fr") |
| `keyword` | string | `==`, `!=` | Searches within lemma AND inflected forms (partial match, case-insensitive) |
| `category` | string[] | `in` | Filters by word categories/tags (OR logic) |
| `surface` | string[] | `in` | Batch lookup by exact lemma OR inflected forms (exact match) |

## Filter Examples

### Language Filtering

Find all English words:
```
filter: 'language == "en"'
```

Find all French words:
```
filter: 'language == "fr"'
```

### Keyword Search

The `keyword` field searches in both the lemma and all inflected forms, making it ideal for fuzzy search:

Search for words containing "book":
```
filter: 'keyword == "book"'
// Finds: "book", "books", "booking", etc.
```

**Search by inflected form** - finds the base word:
```
filter: 'keyword == "apples"'
// Finds: "apple" (because "apples" is its plural form)
```

```
filter: 'keyword == "running"'
// Finds: "run" (because "running" is its present participle)
```

**Partial match**:
```
filter: 'keyword == "swim"'
// Finds: "swim" (matches lemma and forms like "swimming", "swam")
```

### Category Filtering

Find CET-4 level words:
```
filter: 'category in ["cet4"]'
```

Find words that are in either CET-4 OR CET-6:
```
filter: 'category in ["cet4", "cet6"]'
```

### Surface Term Lookup (Batch Lookup)

The `surface` field enables **exact match** batch lookup of words by their lemma or inflected forms.

**Key differences from `keyword`**:
- `keyword`: Partial match (contains), searches in both lemma and forms
- `surface`: Exact match, used for batch lookup of specific terms

The `surface` field is particularly useful for:
- Looking up multiple specific words in one query
- Finding words by exact inflected forms (e.g., "running" → "run")
- Batch operations with exact term matching

Find word by exact lemma:
```
filter: 'surface in ["run"]'
```

Find word by exact inflected form:
```
filter: 'surface in ["running"]'
// Returns: "run" (exact match on the form "running")
```

Batch lookup multiple words:
```
filter: 'surface in ["run", "swim", "walk"]'
// Returns all three words
```

Batch lookup by mixed lemmas and forms:
```
filter: 'surface in ["running", "swam", "walked"]'
// Returns: run, swim, walk (by their inflected forms)
```

### Combined Filtering

English words in technology category:
```
filter: 'language == "en" && category in ["technology"]'
```

CET-4 words containing "comp":
```
filter: 'keyword == "comp" && category in ["cet4"]'
```

English words matching specific surface forms:
```
filter: 'language == "en" && surface in ["running", "swimming"]'
```

## Sorting

The `order_by` field supports:

| Field | Description |
|-------|-------------|
| `lemma` | Sort by lemma alphabetically |
| `created_at` | Sort by creation time |
| `updated_at` | Sort by last update time |

Add `desc` for descending order:

```
order_by: "lemma"           # Ascending (A-Z)
order_by: "lemma desc"      # Descending (Z-A)
order_by: "created_at desc" # Newest first
```

## Pagination

Standard pagination with page number and page size:

```protobuf
pagination: {
  page_no: 1,
  page_size: 20
}
```

- `page_no`: Page number (1-indexed)
- `page_size`: Number of items per page (max: 100)

## Complete Examples

### Example 1: English CET-4 words, sorted alphabetically

```json
{
  "filter": "language == \"en\" && category in [\"cet4\"]",
  "order_by": "lemma",
  "pagination": {
    "page_no": 1,
    "page_size": 50
  }
}
```

### Example 2: Batch lookup with sorting

```json
{
  "filter": "surface in [\"running\", \"swimming\", \"walking\"]",
  "order_by": "lemma",
  "pagination": {
    "page_no": 1,
    "page_size": 10
  }
}
```

### Example 3: Technology words updated recently

```json
{
  "filter": "language == \"en\" && category in [\"technology\"]",
  "order_by": "updated_at desc",
  "pagination": {
    "page_no": 1,
    "page_size": 20
  }
}
```

## Implementation Details

### Surface Term Lookup

The `surface` field uses a sophisticated query that:
1. Matches the word's lemma directly (case-insensitive)
2. Joins with the `lexemes` and `lexeme_forms` tables to find words with matching inflected forms
3. Uses OR logic to return words that match ANY of the provided surface terms

SQL logic (simplified):
```sql
SELECT * FROM words
WHERE
  LOWER(lemma) IN ('running', 'swimming') OR
  EXISTS (
    SELECT 1 FROM lexemes l
    JOIN lexeme_forms f ON l.id = f.lexeme_id
    WHERE l.word_id = words.id
      AND LOWER(f.text) IN ('running', 'swimming')
  )
```

This enables efficient batch lookup while maintaining the ability to find words by any of their forms.

### Category Filtering Logic

Category filtering uses OR logic:
- `category in ["cet4", "cet6"]` returns words that have EITHER "cet4" OR "cet6" in their categories array
- A word with `categories: ["cet4", "technology"]` will match the above filter

### Performance Considerations

- Keyword searches use case-insensitive partial matching
- Surface term lookups use indexed queries for efficiency
- Category filtering leverages JSONB array operators in PostgreSQL
- Pagination is applied after filtering and sorting to minimize data transfer

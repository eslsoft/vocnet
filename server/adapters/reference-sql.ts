import type { CefrRow, FrequencyRow } from '@server/domain/reference'
import type { ReferenceSource } from '@shared/reference'

// Renders one reference import as SQL statements for D1 (`wrangler d1 execute --file`). An
// import replaces all reference data, so applying it twice, or after an older import with
// other rows or sources, leaves exactly the rows of this one.

export interface ReferenceImport {
  sources: ReferenceSource[]
  frequency: { sourceId: string; rows: FrequencyRow[] }
  cefr: CefrRow[]
}

/** Rows per INSERT: well under D1's 100 KB statement limit for any lemma the sources list. */
const CHUNK = 500

const text = (value: string) => `'${value.replaceAll("'", "''")}'`

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Cannot store ${value} as a number.`)
  return String(value)
}

function inserts(table: string, columns: string[], rows: string[][]): string[] {
  const statements = []
  for (let start = 0; start < rows.length; start += CHUNK) {
    const values = rows.slice(start, start + CHUNK).map((row) => `(${row.join(', ')})`)
    statements.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values.join(',\n')};`)
  }
  return statements
}

export function referenceImportSql({ sources, frequency, cefr }: ReferenceImport): string[] {
  const known = new Set(sources.map((source) => source.id))
  for (const id of [frequency.sourceId, ...cefr.map((row) => row.sourceId)]) {
    if (!known.has(id)) throw new Error(`Reference rows name the unknown source ${id}.`)
  }
  return [
    'DELETE FROM word_frequency;',
    'DELETE FROM lemma_cefr;',
    `DELETE FROM reference_sources WHERE id NOT IN (${sources.map((source) => text(source.id)).join(', ')});`,
    ...sources.map(
      (source) =>
        `INSERT INTO reference_sources (id, name, version, license, license_url, changes, attribution, url, retrieved_at) VALUES (${[
          source.id,
          source.name,
          source.version,
          source.license,
          source.license_url,
          source.changes,
          source.attribution,
          source.url,
          source.retrieved_at,
        ]
          .map(text)
          .join(', ')}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, version = excluded.version, ` +
        'license = excluded.license, license_url = excluded.license_url, changes = excluded.changes, attribution = excluded.attribution, url = excluded.url, retrieved_at = excluded.retrieved_at;',
    ),
    ...inserts(
      'word_frequency',
      ['word', 'zipf', 'rank', 'source_id'],
      frequency.rows.map((row) => [text(row.word), number(row.zipf), number(row.rank), text(frequency.sourceId)]),
    ),
    ...inserts(
      'lemma_cefr',
      ['lemma', 'pos', 'level', 'source_id'],
      cefr.map((row) => [text(row.lemma), text(row.pos), text(row.level), text(row.sourceId)]),
    ),
  ]
}

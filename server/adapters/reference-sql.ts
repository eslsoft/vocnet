import { type CefrRow, type FrequencyRow, levelRank } from '@server/domain/reference'
import { BANDS, BATCH_SPAN, CORE_BANDS, STAGES } from '@server/domain/work'
import { cefrLevelSchema, type ReferenceSource } from '@shared/reference'

// Renders one reference import as SQL statements for D1 (`wrangler d1 execute --file`). An
// import replaces all reference data, so applying it twice, or after an older import with
// other rows or sources, leaves exactly the rows of this one, then re-ranks the worklist and marks
// every public view stale.

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

const levelRankOfRow = `case level ${cefrLevelSchema.options.map((level) => `when '${level}' then ${levelRank(level)}`).join(' ')} end`

/** The `levelRank` of the lowest CEFR level listed for the exact lemma the SQL expression gives; null when none is. */
export const levelRankSql = (lemma: string) =>
  `(select min(${levelRankOfRow}) from lemma_cefr where lemma_cefr.lemma = ${lemma})`

/**
 * Rereads every worklist row's learner priority from the reference tables: CEFR by the entry's
 * exact lemma, frequency by the row's frequency key. It ends every import, so a reimport re-ranks
 * the worklist; the backfill migration `worklist_learner_priority_backfill` runs the same update.
 */
export const rankWorklistSql = `UPDATE worklist SET level_rank = ${levelRankSql(
  '(select lemma from entries where entries.id = worklist.entry_id)',
)}, zipf = (select zipf from word_frequency where word_frequency.word = worklist.frequency_key);`

/**
 * Re-ranks every work item from its entry's reread learner priority: `workPriority` in
 * server/domain/work.ts: the headword batch (0 for none), the tier (core bands first), the stage times the band count plus `learnerBand`, and the Zipf frequency
 * with -1 for none. It follows `rankWorklistSql` in every import, so a reimport moves the queue.
 */
const bandSql =
  '(select case when level_rank is not null then level_rank - 1 when zipf is null then 7 else 6 end from worklist where worklist.entry_id = work_items.entry_id)'

const batchSql = '(select coalesce(batch, 0) from worklist where worklist.entry_id = work_items.entry_id)'

export const rankWorkItemsSql = `UPDATE work_items SET rank = ${batchSql} * ${BATCH_SPAN} + (case when ${bandSql} < ${CORE_BANDS} then 0 else ${(STAGES + 1) * BANDS} end) + stage * ${BANDS} + ${bandSql}, zipf_order = coalesce((select zipf from worklist where worklist.entry_id = work_items.entry_id), -1);`

/**
 * Marks every entry's public view stale, since its document carries the frequency and CEFR levels
 * the import replaced. It bumps the shared `revision`, and with it `scored_revision` where the
 * scores were current: reference data is not part of the scores, so they still describe the row,
 * and its items, already re-ranked, stay as they are. A rescore in flight reads the old revision
 * and saves nothing, as after any other bump.
 */
export const staleViewsSql =
  'UPDATE worklist SET revision = revision + 1, scored_revision = CASE WHEN scored_revision = revision THEN revision + 1 ELSE scored_revision END;'

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
    rankWorklistSql,
    rankWorkItemsSql,
    staleViewsSql,
  ]
}

import {
  canonicalUnit,
  ENTRY_UNIT_TABLES,
  type EntryUnit,
  type EntryUnitTable,
  entryIdOf,
  entryKey,
  mediaKey,
  type ReplicaPlan,
  type ReplicaRow,
  replicaRow,
  TOPICS_KEY,
} from '@server/domain/replica'

// The SQL of a public replica sync (server/domain/replica.ts): what reads the source, and the
// statements that apply a unit to the replica (`wrangler d1 execute --file`). Applying a unit
// replaces the replica's rows of it, so applying it twice leaves the same rows, and its manifest
// row is written last, so a sync cut off before it copies the unit again next time.

/** The replica's manifest: one row per unit it holds. Only the sync reads or writes it. */
export const replicaManifestSql =
  'CREATE TABLE IF NOT EXISTS replica_manifest (key text PRIMARY KEY NOT NULL, fingerprint text NOT NULL, synced_at text NOT NULL);'

export const readManifestSql = 'SELECT key, fingerprint FROM replica_manifest;'

/** The entries a replica serves: those with a public view. */
export const publicEntryIdsSql = 'SELECT entry_id FROM public_entries ORDER BY entry_id;'

export const unitReadSql = Object.fromEntries(
  ENTRY_UNIT_TABLES.map(({ table, entryColumn }) => [table, `SELECT * FROM ${table} WHERE ${entryColumn} = ?;`]),
) as Record<EntryUnitTable, string>

export const topicsReadSql = 'SELECT * FROM topics;'

/**
 * The media files the source's rows name: the topics' pictures, and the pictures of the published
 * image facts, which the public views show (a few, of examples no longer published, are copied
 * without being shown).
 */
export const mediaIdsSql = `SELECT image_id FROM topics WHERE image_id IS NOT NULL
UNION SELECT json_extract(payload, '$.image_id') FROM facts WHERE kind = 'image' AND status = 'published'
ORDER BY 1;`

/** Bytes per statement: under D1's 100 KB statement limit. */
const STATEMENT_BUDGET = 90_000

/** Bytes of a text a statement carries at most; a longer one is written in parts. */
const TEXT_PART_BUDGET = 60_000

const bytes = (text: string) => new TextEncoder().encode(text).length

function value(item: string | number | null): string {
  if (item === null) return 'NULL'
  if (typeof item === 'number') {
    if (!Number.isFinite(item)) throw new Error(`Cannot store ${item} as a number.`)
    return String(item)
  }
  return `'${item.replaceAll("'", "''")}'`
}

/** A text in parts whose quoted SQL literals each fit the part budget, split between code points. */
function textParts(text: string): string[] {
  const parts: string[] = []
  let part = ''
  let size = 2
  for (const char of text) {
    const charSize = char === "'" ? 2 : bytes(char)
    if (size + charSize > TEXT_PART_BUDGET) {
      parts.push(part)
      part = ''
      size = 2
    }
    part += char
    size += charSize
  }
  parts.push(part)
  return parts
}

/**
 * A row too long for one statement: an INSERT with each long text's first part, then one UPDATE per
 * further part that appends it to the row just inserted.
 */
function longRowStatements(head: string, table: string, columns: readonly string[], row: ReplicaRow): string[] {
  const parts = new Map<string, string[]>()
  const first = columns.map((column) => {
    const item = row[column] ?? null
    if (typeof item !== 'string' || bytes(value(item)) <= TEXT_PART_BUDGET) return value(item)
    const [lead = '', ...rest] = textParts(item)
    parts.set(column, rest)
    return value(lead)
  })
  const insert = `${head}(${first.join(', ')});`
  if (bytes(insert) > STATEMENT_BUDGET) throw new Error(`A row of ${table} is too long for a statement even in parts.`)
  return [
    insert,
    ...[...parts].flatMap(([column, rest]) =>
      rest.map(
        (part) => `UPDATE ${table} SET ${column} = ${column} || ${value(part)} WHERE rowid = last_insert_rowid();`,
      ),
    ),
  ]
}

/** INSERTs of the rows, as many to a statement as the budget allows. Every row has the first row's columns. */
function inserts(table: string, rows: readonly ReplicaRow[], suffix = ''): string[] {
  const [first] = rows
  if (!first) return []
  const columns = Object.keys(first)
  const head = `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`
  const headSize = bytes(head) + bytes(suffix) + 1
  const statements: string[] = []
  let values: string[] = []
  let size = headSize
  const flush = () => {
    if (values.length > 0) statements.push(`${head}${values.join(',\n')}${suffix};`)
    values = []
    size = headSize
  }
  for (const row of rows) {
    const tuple = `(${columns.map((column) => value(row[column] ?? null)).join(', ')})`
    const tupleSize = bytes(tuple)
    if (headSize + tupleSize > STATEMENT_BUDGET) {
      // An upsert may update a row instead of inserting one, which last_insert_rowid() does not name.
      if (suffix) throw new Error(`A row of ${table} is too long for an upsert statement.`)
      flush()
      statements.push(...longRowStatements(head, table, columns, row))
      continue
    }
    if (values.length > 0 && size + tupleSize + 2 > STATEMENT_BUDGET) flush()
    values.push(tuple)
    size += tupleSize + 2
  }
  flush()
  return statements
}

const manifestRowSql = (key: string, fingerprint: string, syncedAt: string) =>
  `INSERT INTO replica_manifest (key, fingerprint, synced_at) VALUES (${value(key)}, ${value(fingerprint)}, ${value(syncedAt)}) ` +
  'ON CONFLICT (key) DO UPDATE SET fingerprint = excluded.fingerprint, synced_at = excluded.synced_at;'

/** Records that the replica holds a media file, once the file is stored there. */
export const mediaManifestSql = (mediaId: string, syncedAt: string) =>
  manifestRowSql(mediaKey(mediaId), mediaId, syncedAt)

/** Deletes an entry's rows, referencing rows first. */
const deleteEntryRowsSql = (entryId: string) =>
  [...ENTRY_UNIT_TABLES]
    .reverse()
    .map(({ table, entryColumn }) => `DELETE FROM ${table} WHERE ${entryColumn} = ${value(entryId)};`)

/** Takes an entry the source no longer serves off the replica. */
export function removeEntrySql(entryId: string): string[] {
  return [...deleteEntryRowsSql(entryId), `DELETE FROM replica_manifest WHERE key = ${value(entryKey(entryId))};`]
}

/** Replaces the replica's rows of an entry with the unit's. */
export function pushEntrySql(unit: EntryUnit, fingerprint: string, syncedAt: string): string[] {
  return [
    ...deleteEntryRowsSql(unit.entryId),
    ...ENTRY_UNIT_TABLES.flatMap(({ table }) =>
      inserts(
        table,
        unit.rows[table].map((row) => replicaRow(table, row)),
      ),
    ),
    manifestRowSql(entryKey(unit.entryId), fingerprint, syncedAt),
  ]
}

/** Parents before their children, so every insert finds the parent it names. */
function parentsFirst(rows: readonly ReplicaRow[]): ReplicaRow[] {
  const depth = new Map<unknown, number>()
  const byId = new Map(rows.map((row) => [row.id, row]))
  const depthOf = (row: ReplicaRow, seen: number): number => {
    const known = depth.get(row.id)
    if (known !== undefined) return known
    const parent = row.parent_id === null ? undefined : byId.get(row.parent_id)
    if (seen > rows.length) throw new Error(`Topic ${row.id} is in a parent cycle.`)
    const own = parent ? depthOf(parent, seen + 1) + 1 : 0
    depth.set(row.id, own)
    return own
  }
  return [...rows].sort((a, b) => depthOf(a, 0) - depthOf(b, 0) || String(a.id).localeCompare(String(b.id)))
}

/** Makes the replica's topic taxonomy the source's: upserts every topic, then drops the ones it lacks. */
export function pushTopicsSql(rows: readonly ReplicaRow[], fingerprint: string, syncedAt: string): string[] {
  const [first] = rows
  if (!first) throw new Error('The source has no topics.')
  const updates = Object.keys(first)
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')
  return [
    ...inserts('topics', parentsFirst(rows), ` ON CONFLICT (id) DO UPDATE SET ${updates}`),
    `DELETE FROM topics WHERE id NOT IN (${rows.map((row) => value(row.id)).join(', ')});`,
    manifestRowSql(TOPICS_KEY, fingerprint, syncedAt),
  ]
}

/** Reads the units of the database a replica is synced from. */
export interface ReplicaSource {
  publicEntryIds(): Promise<string[]>
  unit(entryId: string): Promise<EntryUnit>
  topics(): Promise<ReplicaRow[]>
}

async function fingerprintOf(tables: ReadonlyArray<readonly [string, readonly ReplicaRow[]]>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalUnit(tables)))
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const unitTables = (unit: EntryUnit) =>
  ENTRY_UNIT_TABLES.map(({ table }) => [table, unit.rows[table].map((row) => replicaRow(table, row))] as const)

/** The fingerprint of every unit the source serves, by manifest key. */
export async function sourceFingerprints(source: ReplicaSource): Promise<Map<string, string>> {
  const fingerprints = new Map<string, string>()
  for (const entryId of await source.publicEntryIds()) {
    fingerprints.set(entryKey(entryId), await fingerprintOf(unitTables(await source.unit(entryId))))
  }
  fingerprints.set(TOPICS_KEY, await fingerprintOf([['topics', await source.topics()]]))
  return fingerprints
}

/**
 * The statements that carry out a plan, one unit's at a time: removals first, since an entry
 * removed may hold the lemma a pushed entry takes. A unit pushed is read again, so its rows are
 * the ones its fingerprint was taken from only when the source has not changed in between: read
 * both from one snapshot.
 */
export async function* syncStatements(
  source: ReplicaSource,
  plan: ReplicaPlan,
  fingerprints: ReadonlyMap<string, string>,
  syncedAt: string,
): AsyncGenerator<string[]> {
  for (const key of plan.remove) yield removeEntrySql(entryIdOf(key))
  for (const key of plan.push) {
    const fingerprint = fingerprints.get(key)
    if (fingerprint === undefined) throw new Error(`The plan pushes ${key}, which the source does not serve.`)
    if (key === TOPICS_KEY) yield pushTopicsSql(await source.topics(), fingerprint, syncedAt)
    else yield pushEntrySql(await source.unit(entryIdOf(key)), fingerprint, syncedAt)
  }
}

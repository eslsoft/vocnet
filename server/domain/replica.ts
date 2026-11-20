// A public replica: a deployment that serves only the public reads, from rows copied out of the
// database where the facts are produced. The unit of a copy is one public entry: its node rows, a
// worklist row, and its public view rows. The replica keeps a manifest of each unit's fingerprint,
// so a sync compares fingerprints and copies only the units that changed.

/** A row as SQLite returns it: column name to value. */
export type ReplicaRow = Record<string, string | number | null>

/** The tables of an entry's unit in insert order (referenced rows first), each with its entry column. */
export const ENTRY_UNIT_TABLES = [
  { table: 'entries', entryColumn: 'id' },
  { table: 'senses', entryColumn: 'entry_id' },
  { table: 'worklist', entryColumn: 'entry_id' },
  { table: 'public_entries', entryColumn: 'entry_id' },
  { table: 'public_meanings', entryColumn: 'entry_id' },
  { table: 'public_forms', entryColumn: 'entry_id' },
  { table: 'public_sense_topics', entryColumn: 'entry_id' },
  { table: 'public_morphemes', entryColumn: 'entry_id' },
  { table: 'public_hypernyms', entryColumn: 'entry_id' },
  { table: 'public_search', entryColumn: 'entry_id' },
] as const

export type EntryUnitTable = (typeof ENTRY_UNIT_TABLES)[number]['table']

/** One entry's rows, by table. */
export type EntryUnit = { entryId: string; rows: Record<EntryUnitTable, ReplicaRow[]> }

/** The manifest key of an entry's unit, and of the topic taxonomy, the one unit no entry owns. */
const ENTRY_PREFIX = 'entry:'
export const entryKey = (entryId: string) => `${ENTRY_PREFIX}${entryId}`
/** The entry an entry's key names. */
export function entryIdOf(key: string): string {
  if (!key.startsWith(ENTRY_PREFIX)) throw new Error(`${key} is not an entry's key.`)
  return key.slice(ENTRY_PREFIX.length)
}
export const TOPICS_KEY = 'topics'

/**
 * The manifest key of a media file the replica holds. A file is named by the SHA-256 of its bytes,
 * so the key alone says it is there and unchanged; files are never removed, since no row names
 * one the replica lacks and an unused one costs only its storage.
 */
const MEDIA_PREFIX = 'media:'
export const mediaKey = (mediaId: string) => `${MEDIA_PREFIX}${mediaId}`
const isMediaKey = (key: string) => key.startsWith(MEDIA_PREFIX)

/**
 * The row a unit carries for its source row. A public read rebuilds a view whose revision differs
 * from the worklist's, which needs the facts; the replica has none, so its worklist rows hold only
 * what reads need, with every revision equal. `public_search` drops its id: the replica numbers
 * its own rows, and the full-text index follows them.
 */
export function replicaRow(table: EntryUnitTable, row: ReplicaRow): ReplicaRow {
  if (table === 'worklist') {
    return { entry_id: row.entry_id, created_at: row.created_at, live: row.live }
  }
  if (table === 'public_search') {
    const { id: _id, ...rest } = row
    return rest
  }
  return row
}

/**
 * The text a unit's fingerprint hashes: every table's rows, each row's values in column order,
 * the rows sorted, so the order a query returns them in does not count as a change.
 */
export function canonicalUnit(tables: ReadonlyArray<readonly [string, readonly ReplicaRow[]]>): string {
  return JSON.stringify(
    tables.map(([table, rows]) => [table, rows.map((row) => JSON.stringify(Object.entries(row))).sort()]),
  )
}

export interface ReplicaPlan {
  /** Units the replica lacks or holds with another fingerprint. */
  push: string[]
  /** Units the replica holds that the source no longer has. */
  remove: string[]
  unchanged: number
  /** The media files the source's rows name that the replica lacks, copied before any unit. */
  media: string[]
}

/**
 * What a sync copies: compares the source's fingerprints with the replica's manifest, and the media
 * files the source's rows name with the ones the manifest lists.
 */
export function planReplicaSync(
  source: ReadonlyMap<string, string>,
  replica: ReadonlyMap<string, string>,
  mediaIds: readonly string[],
): ReplicaPlan {
  const push: string[] = []
  let unchanged = 0
  for (const [key, fingerprint] of source) {
    if (replica.get(key) === fingerprint) unchanged += 1
    else push.push(key)
  }
  const remove = [...replica.keys()].filter((key) => !isMediaKey(key) && !source.has(key))
  const media = [...new Set(mediaIds)].filter((id) => !replica.has(mediaKey(id)))
  return { push: push.sort(), remove: remove.sort(), unchanged, media: media.sort() }
}

// Syncs a public replica (docs/design.md, Public replica) from the local database where the facts
// are produced: copies the media files its rows name that the replica lacks, then the public
// entries whose rows changed since the last sync, takes off the ones no longer public, and keeps
// the replica's topics equal to the source's.
//
// Usage: node scripts/replica/sync.mjs [--source <file.sqlite>] [--media-source <dir>]
//          [--database vocnet] [--bucket vocnet-media] [--wrangler "<command>"] [--dry-run]
//          [--media-concurrency 32] [--skip-media]
//          -- <wrangler target flags, e.g. --remote>
//
// --source defaults to the local D1 file under .wrangler, --media-source to the local state the
// media files are read from (.wrangler/state). --wrangler is the command that runs Wrangler
// (default `pnpm exec wrangler`); the target flags after `--` pick the replica as `wrangler d1
// execute` does: `--remote`, `--remote --preview`, or `--local --persist-to <dir>` for a
// rehearsal. --bucket is the replica's media bucket: vocnet-media-preview for a preview.
//
// Media files are read straight from the local bucket's state and, for a --remote replica, put with
// R2's REST API (CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN or Wrangler's own login), many at
// a time; each batch is recorded in the manifest as it lands, so a stopped sync resumes where it
// was. A --local rehearsal puts them with `wrangler r2 object put`.
import '../server-modules.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const { DatabaseSync } = await import('node:sqlite')
const { ENTRY_UNIT_TABLES, planReplicaSync } = await import('../../server/domain/replica.ts')
const { WEBP } = await import('../../server/domain/media.ts')
const sql = await import('../../server/adapters/replica-sql.ts')

const separator = process.argv.indexOf('--')
if (separator === -1) throw new Error('Name the replica after `--`, for example `-- --remote`.')
const { values: options } = parseArgs({
  args: process.argv.slice(2, separator),
  options: {
    source: { type: 'string' },
    'media-source': { type: 'string', default: '.wrangler/state' },
    database: { type: 'string', default: 'vocnet' },
    bucket: { type: 'string', default: 'vocnet-media' },
    wrangler: { type: 'string', default: 'pnpm exec wrangler' },
    'dry-run': { type: 'boolean', default: false },
    'media-concurrency': { type: 'string', default: '32' },
    'skip-media': { type: 'boolean', default: false },
  },
})
const target = process.argv.slice(separator + 1)
/** `wrangler r2 object` has no --preview: a preview's bucket is named by --bucket instead. */
const mediaTarget = target.filter((flag) => flag !== '--preview')
/** The bucket the Worker's MEDIA binding names locally, where the source's files are. */
const SOURCE_BUCKET = 'vocnet-media'

/** Bytes per SQL file: one `wrangler d1 execute --file` import each. */
const FILE_BUDGET = 50 * 1024 * 1024

function localDatabase() {
  const directory = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
  const files = readdirSync(directory).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  if (files.length !== 1) throw new Error(`Expected one local D1 file in ${directory}; pass --source.`)
  return path.join(directory, files[0])
}

/** Runs Wrangler with the arguments; its stdout is returned, its errors shown. */
function runWrangler(args) {
  const [command, ...prefix] = options.wrangler.split(' ').filter(Boolean)
  const run = spawnSync(command, [...prefix, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (run.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} exited with ${run.status}.`)
  return run.stdout
}

/** Runs Wrangler with the arguments without blocking, for the media copies that run side by side. */
function runWranglerAsync(args) {
  const [command, ...prefix] = options.wrangler.split(' ').filter(Boolean)
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, ...args], { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('error', reject)
    child.on('close', (status) =>
      status === 0 ? resolve() : reject(new Error(`wrangler ${args.slice(0, 3).join(' ')} exited with ${status}.`)),
    )
  })
}

/** Runs `wrangler d1 execute` against the replica. */
const wrangler = (args) => runWrangler(['d1', 'execute', options.database, ...target, ...args])

/** Media manifest rows per `d1 execute`: a batch of copies is recorded as soon as it lands. */
const MANIFEST_BATCH = 200

/** Reads a media file's bytes from the local bucket's Miniflare state. */
function localMediaReader() {
  const state = path.join(options['media-source'], 'v3', 'r2')
  const directory = path.join(state, 'miniflare-R2BucketObject')
  const files = readdirSync(directory).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  if (files.length !== 1) throw new Error(`Expected one local R2 object file in ${directory}.`)
  const objects = new DatabaseSync(path.resolve(directory, files[0]), { readOnly: true })
  const blob = objects.prepare('SELECT blob_id FROM _mf_objects WHERE key = ?')
  return (id) => {
    const row = blob.get(id)
    if (!row) throw new Error(`The local bucket has no media file ${id}.`)
    return readFileSync(path.join(state, SOURCE_BUCKET, 'blobs', row.blob_id))
  }
}

/** The OAuth token Wrangler keeps after `wrangler whoami` refreshes it, when no API token is set. */
function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN
  runWrangler(['whoami'])
  const config = [
    path.join(homedir(), 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'),
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), '.wrangler', 'config', 'default.toml'),
  ].find((file) => {
    try {
      readFileSync(file)
      return true
    } catch {
      return false
    }
  })
  const token = config && /^oauth_token\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1]
  if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN or log in with `wrangler login`.')
  return token
}

/** Puts media files into the replica's bucket: R2's REST API for --remote, Wrangler otherwise. */
function mediaWriter(directory) {
  if (!mediaTarget.includes('--remote')) {
    return async (id, bytes) => {
      const file = path.join(directory, id)
      writeFileSync(file, bytes)
      await runWranglerAsync(['r2', 'object', 'put', `${options.bucket}/${id}`, ...mediaTarget, '--file', file, '--content-type', WEBP])
      rmSync(file)
    }
  }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!account) throw new Error('Set CLOUDFLARE_ACCOUNT_ID to copy media to a remote bucket.')
  let token = apiToken()
  return async (id, bytes) => {
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${options.bucket}/objects/${id}`
    const put = () => fetch(url, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': WEBP }, body: bytes })
    let response = await put()
    // An OAuth token lives an hour; a long copy outlives it.
    if (response.status === 401 || response.status === 403) {
      token = apiToken()
      response = await put()
    }
    if (!response.ok) throw new Error(`R2 answered ${response.status} for ${id}: ${(await response.text()).slice(0, 200)}`)
  }
}

/**
 * Runs a media step again after a failure, up to four times: R2's API answers an occasional 500 or
 * 503 that asks to try again. A put of the same bytes is idempotent.
 */
async function retried(id, step) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step()
    } catch (error) {
      if (attempt === 4) throw error
      console.info(`Retrying media ${id} (attempt ${attempt + 1}): ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt))
    }
  }
}

/**
 * Copies the media files --media-concurrency at a time and records each batch of MANIFEST_BATCH in
 * the replica's manifest once it has landed. The first failure stops the sync once the copies
 * already running have ended; what was recorded stays, so the next sync skips it.
 */
async function copyAllMedia(ids, directory, syncedAt) {
  const read = localMediaReader()
  const write = mediaWriter(directory)
  let next = 0
  let failed = false
  let landed = []
  let recorded = 0
  const record = () => {
    if (landed.length === 0) return
    const batch = landed
    landed = []
    wrangler(['--command', batch.map((id) => sql.mediaManifestSql(id, syncedAt)).join(' ')])
    recorded += batch.length
    console.info(`Copied media ${recorded}/${ids.length}`)
  }
  const worker = async () => {
    while (!failed && next < ids.length) {
      const id = ids[next++]
      try {
        await retried(id, () => write(id, read(id)))
      } catch (error) {
        failed = true
        throw error
      }
      landed.push(id)
      if (landed.length >= MANIFEST_BATCH) record()
    }
  }
  const workers = Math.max(1, Number(options['media-concurrency']))
  const results = await Promise.allSettled(Array.from({ length: Math.min(workers, ids.length) }, worker))
  record()
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

// One read transaction: every unit is read from the same snapshot while the producer keeps writing.
const database = new DatabaseSync(options.source ?? localDatabase(), { readOnly: true })
database.exec('BEGIN')
const reads = Object.fromEntries(
  ENTRY_UNIT_TABLES.map(({ table }) => [table, database.prepare(sql.unitReadSql[table])]),
)
const source = {
  publicEntryIds: async () => database.prepare(sql.publicEntryIdsSql).all().map((row) => row.entry_id),
  unit: async (entryId) => ({
    entryId,
    rows: Object.fromEntries(ENTRY_UNIT_TABLES.map(({ table }) => [table, reads[table].all(entryId)])),
  }),
  topics: async () => database.prepare(sql.topicsReadSql).all(),
}

const fingerprints = await sql.sourceFingerprints(source)
wrangler(['--command', sql.replicaManifestSql])
const [manifest] = JSON.parse(wrangler(['--command', sql.readManifestSql, '--json']))
const mediaIds = database.prepare(sql.mediaIdsSql).all().map((row) => row.image_id)
const plan = planReplicaSync(
  fingerprints,
  new Map(manifest.results.map((row) => [row.key, row.fingerprint])),
  // --skip-media pushes the rows before their files, which a later sync copies; until then a picture
  // the rows name answers 404.
  options['skip-media'] ? [] : mediaIds,
)
console.info(
  `${plan.media.length} media files to copy, ${plan.push.length} to push, ${plan.remove.length} to remove, ${plan.unchanged} unchanged`,
)

if (!options['dry-run'] && plan.media.length + plan.push.length + plan.remove.length > 0) {
  const directory = mkdtempSync(path.join(tmpdir(), 'vocnet-replica-'))
  try {
    // The files go first, so no row the replica serves names a file it lacks.
    const syncedAt = new Date().toISOString()
    await copyAllMedia(plan.media, directory, syncedAt)
    const files = []
    let statements = []
    let size = 0
    const flush = () => {
      if (statements.length === 0) return
      const file = path.join(directory, `${String(files.length).padStart(4, '0')}.sql`)
      writeFileSync(file, `${statements.join('\n')}\n`)
      files.push(file)
      statements = []
      size = 0
    }
    for await (const unit of sql.syncStatements(source, plan, fingerprints, syncedAt)) {
      const unitSize = unit.reduce((total, statement) => total + statement.length + 1, 0)
      if (size > 0 && size + unitSize > FILE_BUDGET) flush()
      statements.push(...unit)
      size += unitSize
    }
    flush()
    for (const [index, file] of files.entries()) {
      console.info(`Applying ${index + 1}/${files.length}`)
      wrangler(['--file', file, '--yes'])
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
database.exec('COMMIT')
database.close()

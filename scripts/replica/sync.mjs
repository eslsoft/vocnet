// Syncs a public replica (docs/design.md, Public replica) from the local database where the facts
// are produced: copies the media files its rows name that the replica lacks, then the public
// entries whose rows changed since the last sync, takes off the ones no longer public, and keeps
// the replica's topics equal to the source's.
//
// Usage: node scripts/replica/sync.mjs [--source <file.sqlite>] [--media-source <dir>]
//          [--database vocnet] [--bucket vocnet-media] [--wrangler "<command>"] [--dry-run]
//          [--media-concurrency 8] [--skip-media]
//          -- <wrangler target flags, e.g. --remote>
//
// --source defaults to the local D1 file under .wrangler, --media-source to the local state the
// media files are read from (.wrangler/state). --wrangler is the command that runs Wrangler
// (default `pnpm exec wrangler`); the target flags after `--` pick the replica as `wrangler d1
// execute` does: `--remote`, `--remote --preview`, or `--local --persist-to <dir>` for a
// rehearsal. --bucket is the replica's media bucket: vocnet-media-preview for a preview.
import '../server-modules.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
    'media-concurrency': { type: 'string', default: '8' },
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

/** Copies a media file from the local state to the replica's bucket. */
async function copyMedia(id, directory) {
  const file = path.join(directory, id)
  await retried(id, () =>
    runWranglerAsync(['r2', 'object', 'get', `${SOURCE_BUCKET}/${id}`, '--local', '--persist-to', options['media-source'], '--file', file]),
  )
  await retried(id, () =>
    runWranglerAsync(['r2', 'object', 'put', `${options.bucket}/${id}`, ...mediaTarget, '--file', file, '--content-type', WEBP]),
  )
  rmSync(file)
}

/**
 * Runs a media step again after a failure, up to four times: R2's API answers an occasional 500 or
 * 503 that asks to try again, and the local bucket an occasional internal error under concurrent
 * reads. A get or a put of the same bytes is idempotent.
 */
async function retried(id, step) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step()
    } catch (error) {
      if (attempt === 4) throw error
      console.info(`Retrying media ${id} (attempt ${attempt + 1})`)
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt))
    }
  }
}

/**
 * Copies the media files --media-concurrency at a time. The first failure stops the sync once the
 * copies already running have ended, so none of them loses its file to the directory's removal.
 */
async function copyAllMedia(ids, directory) {
  let next = 0
  let copied = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < ids.length) {
      const id = ids[next++]
      try {
        await copyMedia(id, directory)
      } catch (error) {
        failed = true
        throw error
      }
      copied += 1
      if (copied % 50 === 0 || copied === ids.length) console.info(`Copied media ${copied}/${ids.length}`)
    }
  }
  const workers = Math.max(1, Number(options['media-concurrency']))
  const results = await Promise.allSettled(Array.from({ length: Math.min(workers, ids.length) }, worker))
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
    await copyAllMedia(plan.media, directory)
    const files = []
    let statements = plan.media.map((id) => sql.mediaManifestSql(id, syncedAt))
    let size = statements.reduce((total, statement) => total + statement.length + 1, 0)
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

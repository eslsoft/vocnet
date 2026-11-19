// Syncs a public replica (docs/design.md, Public replica) from the local database where the facts
// are produced: copies the public entries whose rows changed since the last sync, takes off the
// ones no longer public, and keeps the replica's topics equal to the source's.
//
// Usage: node scripts/replica/sync.mjs [--source <file.sqlite>] [--database vocnet]
//          [--wrangler "<command>"] [--dry-run] -- <wrangler target flags, e.g. --remote>
//
// --source defaults to the local D1 file under .wrangler. --wrangler is the command that runs
// Wrangler (default `pnpm exec wrangler`); the target flags after `--` pick the replica database
// as `wrangler d1 execute` does: `--remote`, or `--local --persist-to <dir>` for a rehearsal.
import '../server-modules.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const { DatabaseSync } = await import('node:sqlite')
const { ENTRY_UNIT_TABLES, planReplicaSync } = await import('../../server/domain/replica.ts')
const sql = await import('../../server/adapters/replica-sql.ts')

const separator = process.argv.indexOf('--')
if (separator === -1) throw new Error('Name the replica after `--`, for example `-- --remote`.')
const { values: options } = parseArgs({
  args: process.argv.slice(2, separator),
  options: {
    source: { type: 'string' },
    database: { type: 'string', default: 'vocnet' },
    wrangler: { type: 'string', default: 'pnpm exec wrangler' },
    'dry-run': { type: 'boolean', default: false },
  },
})
const target = process.argv.slice(separator + 1)

/** Bytes per SQL file: one `wrangler d1 execute --file` import each. */
const FILE_BUDGET = 50 * 1024 * 1024

function localDatabase() {
  const directory = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
  const files = readdirSync(directory).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  if (files.length !== 1) throw new Error(`Expected one local D1 file in ${directory}; pass --source.`)
  return path.join(directory, files[0])
}

/** Runs `wrangler d1 execute` against the replica; its stdout is returned, its errors shown. */
function wrangler(args) {
  const [command, ...prefix] = options.wrangler.split(' ').filter(Boolean)
  const run = spawnSync(command, [...prefix, 'd1', 'execute', options.database, ...target, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (run.status !== 0) throw new Error(`wrangler d1 execute ${args.join(' ')} exited with ${run.status}.`)
  return run.stdout
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
const plan = planReplicaSync(fingerprints, new Map(manifest.results.map((row) => [row.key, row.fingerprint])))
console.info(`${plan.push.length} to push, ${plan.remove.length} to remove, ${plan.unchanged} unchanged`)

if (!options['dry-run'] && plan.push.length + plan.remove.length > 0) {
  const directory = mkdtempSync(path.join(tmpdir(), 'vocnet-replica-'))
  try {
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
    for await (const unit of sql.syncStatements(source, plan, fingerprints, new Date().toISOString())) {
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

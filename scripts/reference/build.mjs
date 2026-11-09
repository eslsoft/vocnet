// Turns the raw export (export.py) into the SQL of one reference import.
//
// Usage: node scripts/reference/build.mjs <raw.json> > reference.sql
//
// It runs the server's own import rules and SQL renderer straight from their TypeScript
// sources: Node strips the types, and the hook below resolves the repo's path aliases and
// extensionless imports the way the bundler does.
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const aliases = { '@server/': path.join(root, 'server/'), '@shared/': path.join(root, 'shared/') }

registerHooks({
  resolve(specifier, context, nextResolve) {
    const alias = Object.keys(aliases).find((prefix) => specifier.startsWith(prefix))
    if (alias) return nextResolve(`${pathToFileURL(aliases[alias] + specifier.slice(alias.length))}.ts`, context)
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const { cefrjPos, mergeCefr, octanovePos, rankFrequencies } = await import('../../server/domain/reference.ts')
const { referenceImportSql } = await import('../../server/adapters/reference-sql.ts')

const manifest = JSON.parse(await readFile(path.join(here, 'sources.json'), 'utf8'))
const raw = JSON.parse(await readFile(process.argv[2], 'utf8'))

// Listed in precedence order: CEFR-J before Octanove.
const posMaps = { 'cefrj-xlsx': cefrjPos, 'olp-csv': octanovePos }
const cefr = mergeCefr(
  manifest.cefr.map((source) => ({
    id: source.id,
    pos: posMaps[source.format],
    rows: raw.cefr[source.id].map(([headword, pos, level]) => ({ headword, pos, level })),
  })),
)
const frequency = rankFrequencies(raw.wordfreq.map(([form, zipf]) => ({ form, zipf })))

const sourceOf = ({ id, name, version, license, license_url, changes, attribution, url, retrieved_at }) => ({
  id,
  name,
  version,
  license,
  license_url,
  changes,
  attribution,
  url,
  retrieved_at,
})
const statements = referenceImportSql({
  sources: [manifest.frequency, ...manifest.cefr].map(sourceOf),
  frequency: { sourceId: manifest.frequency.id, rows: frequency },
  cefr,
})
process.stdout.write(`${statements.join('\n')}\n`)
process.stderr.write(
  `${frequency.length} word_frequency rows, ${cefr.length} lemma_cefr rows, ${1 + manifest.cefr.length} reference_sources rows\n`,
)

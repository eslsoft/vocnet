// Turns the raw export (export.py) into the SQL of one reference import.
//
// Usage: node scripts/reference/build.mjs <raw.json> > reference.sql
//
// It runs the server's own import rules and SQL renderer straight from their TypeScript
// sources through the loader in scripts/server-modules.mjs.
import '../server-modules.mjs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const { cefrjPos, mergeCefr, octanovePos, rankFrequencies } = await import('../../server/domain/reference.ts')
const { referenceImportSql } = await import('../../server/adapters/reference-sql.ts')

const manifest = JSON.parse(await readFile(path.join(here, 'sources.json'), 'utf8'))
const raw = JSON.parse(await readFile(process.argv[2], 'utf8'))

// Listed in precedence order: CEFR-J before Octanove.
const posMaps = { 'cefrj-xlsx': cefrjPos, 'olp-csv': octanovePos }
const { rows: cefr, inflections } = mergeCefr(
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
process.stderr.write(
  `${inflections.length} inflected forms dropped: ${inflections.map((row) => `${row.form} (${row.label}, ${row.sourceId})`).join(', ')}\n`,
)

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()

async function sourceFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(target, predicate)))
    else if (predicate(target)) files.push(target)
  }
  return files
}

function parseScenarios(source, file) {
  const scenarios = []
  let tags = []
  for (const line of source.split('\n')) {
    const tagLine = line.trim()
    if (tagLine.startsWith('@')) {
      tags = tagLine.split(/\s+/).map((tag) => tag.slice(1))
      continue
    }
    if (!tagLine.startsWith('Scenario:')) continue
    const id = tags.find((tag) => tag.includes('/'))
    const layerTag = tags.find((tag) => ['api', 'domain', 'e2e', 'usecase', 'web'].includes(tag))
    if (!id || !layerTag) throw new Error(`${file}: every scenario needs a stable id and proof-layer tag.`)
    const primaryLayer = { api: 'integration', domain: 'unit', e2e: 'e2e', usecase: 'unit', web: 'component' }[
      layerTag
    ]
    scenarios.push({ id, critical: tags.includes('critical'), required: [primaryLayer] })
    if (tags.includes('critical') && primaryLayer !== 'e2e') scenarios.at(-1).required.push('e2e')
    tags = []
  }
  return scenarios
}

const featureFiles = await sourceFiles(path.join(root, 'spec'), (file) => file.endsWith('.feature'))
const scenarios = (
  await Promise.all(featureFiles.map(async (file) => parseScenarios(await readFile(file, 'utf8'), file)))
).flat()
const duplicateIds = scenarios.filter((scenario, index) => scenarios.findIndex(({ id }) => id === scenario.id) !== index)
if (duplicateIds.length > 0) throw new Error(`Duplicate behavior ids: ${duplicateIds.map(({ id }) => id).join(', ')}`)

const layerFiles = {
  unit: (await sourceFiles(path.join(root, 'server'), (file) => file.endsWith('.test.ts'))).filter(
    (file) => !file.includes(`${path.sep}integration${path.sep}`),
  ),
  component: await sourceFiles(path.join(root, 'src'), (file) => /\.test\.tsx?$/.test(file)),
  integration: await sourceFiles(path.join(root, 'server/integration'), (file) => file.endsWith('.test.ts')),
  e2e: await sourceFiles(path.join(root, 'e2e'), (file) => file.endsWith('.spec.ts')),
}

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(layerFiles).map(async ([layer, files]) => [
      layer,
      (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n'),
    ]),
  ),
)
for (const [layer, source] of Object.entries(sources)) {
  if (/\b(?:it|test)\.(?:skip|todo)\s*\(/.test(source)) throw new Error(`${layer}: skipped or todo tests are forbidden.`)
}

const covered = (id, layer) => sources[layer].includes(`[spec: ${id}]`)
const missing = scenarios.flatMap((scenario) =>
  scenario.required.filter((layer) => !covered(scenario.id, layer)).map((layer) => `${scenario.id} -> ${layer}`),
)
const integration = scenarios.filter((scenario) => scenario.required.includes('integration'))
const critical = scenarios.filter((scenario) => scenario.critical)
const percent = (coveredItems, total) => (total === 0 ? 100 : (coveredItems * 100) / total)
const integrationCoverage = percent(
  integration.filter((scenario) => covered(scenario.id, 'integration')).length,
  integration.length,
)
const criticalE2E = percent(
  critical.filter((scenario) => covered(scenario.id, 'e2e')).length,
  critical.length,
)

console.info(`BDD traceability: ${missing.length === 0 ? '100%' : 'incomplete'}`)
console.info(`Integration behavior coverage: ${integrationCoverage.toFixed(0)}%`)
console.info(`Critical E2E behavior coverage: ${criticalE2E.toFixed(0)}%`)
if (missing.length > 0 || integrationCoverage < 100 || criticalE2E < 100) {
  throw new Error(`Behavior coverage gate failed:\n${missing.map((item) => `- ${item}`).join('\n')}`)
}

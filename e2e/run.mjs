import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer as createTcpServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startOidcServer } from './oidc-server.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function availablePort() {
  const server = createTcpServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate an application port.')
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} exited on ${signal}.`))
      else resolve(code ?? 1)
    })
  })
}

const runRoot = await mkdtemp(path.join(tmpdir(), 'vocnet-e2e-'))
const stateDir = path.join(runRoot, 'state')
const configPath = path.join(runRoot, 'wrangler.toml')
const artifactDir = path.join(projectRoot, 'artifacts', 'e2e', new Date().toISOString().replaceAll(':', '-'))
await mkdir(stateDir, { recursive: true })
await mkdir(artifactDir, { recursive: true })

const oidc = await startOidcServer()
let viteServer
try {
  const quoted = (value) => JSON.stringify(value)
  await writeFile(
    configPath,
    `name = "vocnet-e2e"
main = ${quoted(path.join(projectRoot, 'server/worker.ts'))}
compatibility_date = "2026-06-03"
compatibility_flags = ["nodejs_compat"]

[assets]
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true

[vars]
OIDC_ISSUER = ${quoted(oidc.issuer)}
OIDC_CLIENT_ID = "e2e-client"
ADMIN_SUBJECTS = "e2e-user"
# No journey reaches a reviewer; an unroutable gateway makes any accidental call fail loudly.
MODEL_BASE_URL = "http://127.0.0.1:9"
MODEL_API_KEY = "e2e"
JEV_MODEL = "jev-latest"
REVIEW_LLM_MODEL = "e2e-llm"

[[queues.producers]]
binding = "REVIEW_QUEUE"
queue = "vocnet-e2e-reviews"

[[d1_databases]]
binding = "DB"
database_name = "vocnet-e2e"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = ${quoted(path.join(projectRoot, 'migrations'))}
`,
  )

  const migrationExit = await run(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'vocnet-e2e',
      '--local',
      '--config',
      configPath,
      '--persist-to',
      stateDir,
    ],
    { CI: 'true' },
  )
  if (migrationExit !== 0) throw new Error(`D1 migration command exited with ${migrationExit}.`)

  process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH = configPath
  process.env.E2E_PERSIST = stateDir
  process.env.E2E_APP_PORT = String(await availablePort())
  const buildExit = await run('pnpm', ['build'])
  if (buildExit !== 0) throw new Error(`Production build exited with ${buildExit}.`)
  const { preview } = await import('vite')
  viteServer = await preview()
  const address = viteServer.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port.')

  const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== '--')
  const testExit = await run('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs], {
    E2E_BASE_URL: `http://127.0.0.1:${address.port}`,
    E2E_ARTIFACT_DIR: artifactDir,
  })
  if (testExit !== 0) throw new Error(`Playwright exited with ${testExit}. Failure evidence: ${artifactDir}`)
} finally {
  await viteServer?.close()
  await oidc.close()
  await rm(runRoot, { recursive: true })
}

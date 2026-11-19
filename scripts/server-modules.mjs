// Lets a script import the server's TypeScript sources directly: Node strips the types, and this
// hook resolves the repo's path aliases and extensionless imports the way the bundler does.
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

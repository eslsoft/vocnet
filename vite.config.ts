import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

// Vite answers only requests whose Host it knows. A downstream service in a container reaches
// the local Worker as host.docker.internal, so that name is allowed beside localhost.
const allowedHosts = ['host.docker.internal']

export default defineConfig(() => {
  const isVitest = process.env.VITEST === 'true'
  const persistPath = process.env.E2E_PERSIST ?? process.env.VOCNET_PERSIST

  return {
    // Routes are code-split; the remaining vendor core (react, router, query, oidc)
    // legitimately exceeds the default 500kB warning.
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
    plugins: [
      react(),
      tailwindcss(),
      // E2E_PERSIST isolates the local D1/state from the default dev store so
      // end-to-end runs never clobber `pnpm dev` data. VOCNET_PERSIST names another
      // checkout's state directory, so a worktree serves the real local data.
      !isVitest && cloudflare(persistPath ? { persistState: { path: persistPath } } : undefined),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@server': path.resolve(__dirname, './server'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
    server: {
      host: process.env.E2E_APP_PORT ? '127.0.0.1' : undefined,
      port: Number(process.env.E2E_APP_PORT ?? 5173),
      allowedHosts,
      watch: { ignored: ['**/artifacts/**'] },
    },
    preview: {
      host: process.env.E2E_APP_PORT ? '127.0.0.1' : undefined,
      port: Number(process.env.E2E_APP_PORT ?? 4173),
      allowedHosts,
    },
  }
})

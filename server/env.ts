// Bindings/vars are the source of truth in wrangler.toml and .dev.vars.example.
// `pnpm cf-typegen` regenerates server/worker-configuration.d.ts (gitignored),
// which declares the global Cloudflare.Env. Re-exported here so code imports one name.
export type Env = Cloudflare.Env

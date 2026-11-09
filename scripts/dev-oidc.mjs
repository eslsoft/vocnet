// Development only. A throwaway local OIDC provider (the one the E2E suite uses) so
// `pnpm dev` can sign an admin in to the console without a real identity provider.
// It signs any login as one fixed subject; never point a deployed Worker at it.
import process from 'node:process'
import { startOidcServer } from '../e2e/oidc-server.mjs'

const port = Number(process.env.DEV_OIDC_PORT ?? 8788)
const subject = process.env.DEV_OIDC_SUBJECT ?? 'dev-admin'
const { issuer } = await startOidcServer({ port, subject })
console.info(`Dev OIDC provider at ${issuer}, signing in every login as "${subject}".
Point .dev.vars at it, then run pnpm dev:
  OIDC_ISSUER=${issuer}
  OIDC_CLIENT_ID=vocnet-dev
  ADMIN_SUBJECTS=${subject}`)

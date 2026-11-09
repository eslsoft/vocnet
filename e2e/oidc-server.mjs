import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

function json(response, status, body, origin) {
  response.writeHead(status, {
    'access-control-allow-origin': origin,
    'content-type': 'application/json',
  })
  response.end(JSON.stringify(body))
}

export async function startOidcServer() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'e2e', alg: 'ES256', use: 'sig' }
  const codes = new Map()
  let issuer = ''

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, issuer)
    const origin = request.headers.origin ?? '*'
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
      })
      response.end()
      return
    }

    if (url.pathname === '/.well-known/openid-configuration') {
      json(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['ES256'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'profile', 'email'],
      }, origin)
      return
    }

    if (url.pathname === '/jwks') {
      json(response, 200, { keys: [publicJwk] }, origin)
      return
    }

    if (url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state')
      const codeChallenge = url.searchParams.get('code_challenge')
      const clientId = url.searchParams.get('client_id')
      if (!redirectUri || !state || !codeChallenge || !clientId) {
        json(response, 400, { error: 'invalid_request' }, origin)
        return
      }

      const code = crypto.randomUUID()
      codes.set(code, {
        clientId,
        codeChallenge,
        nonce: url.searchParams.get('nonce'),
        redirectUri,
      })
      const callback = new URL(redirectUri)
      callback.searchParams.set('code', code)
      callback.searchParams.set('state', state)
      response.writeHead(302, { location: callback.toString() })
      response.end()
      return
    }

    if (url.pathname === '/token' && request.method === 'POST') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = new URLSearchParams(Buffer.concat(chunks).toString())
      const code = body.get('code')
      const transaction = code ? codes.get(code) : undefined
      const verifier = body.get('code_verifier')
      const challenge = verifier
        ? createHash('sha256').update(verifier).digest('base64url')
        : undefined
      if (
        !code ||
        !transaction ||
        challenge !== transaction.codeChallenge ||
        body.get('redirect_uri') !== transaction.redirectUri ||
        body.get('client_id') !== transaction.clientId
      ) {
        json(response, 400, { error: 'invalid_grant' }, origin)
        return
      }
      codes.delete(code)

      const now = Math.floor(Date.now() / 1000)
      const claims = {
        email: 'e2e@test.invalid',
        name: 'E2E User',
      }
      const accessToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'e2e' })
        .setIssuer(issuer)
        .setAudience(transaction.clientId)
        .setSubject('e2e-user')
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey)
      const idToken = await new SignJWT({ ...claims, nonce: transaction.nonce })
        .setProtectedHeader({ alg: 'ES256', kid: 'e2e' })
        .setIssuer(issuer)
        .setAudience(transaction.clientId)
        .setSubject('e2e-user')
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey)

      json(response, 200, {
        access_token: accessToken,
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 300,
        scope: 'openid profile email',
      }, origin)
      return
    }

    json(response, 404, { error: 'not_found' }, origin)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('OIDC server did not bind a TCP port.')
  issuer = `http://127.0.0.1:${address.port}`
  return { issuer, close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))) }
}

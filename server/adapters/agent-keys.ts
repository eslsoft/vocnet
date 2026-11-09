import type { AgentKeyCrypto } from '@server/usecases/ports'

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export const webCryptoAgentKeys: AgentKeyCrypto = {
  randomSecret() {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
  },
  async hash(key) {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))
  },
}

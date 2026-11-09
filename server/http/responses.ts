import type { ApiErrorCode } from '@shared/types'

export function errorPayload(code: ApiErrorCode, message: string) {
  return { error: { code, message } }
}

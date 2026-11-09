import type { ApiErrorCode } from '@server/usecases/errors'

export function errorPayload(code: ApiErrorCode | 'internal_error', message: string) {
  return { error: { code, message } }
}

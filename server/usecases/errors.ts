import type { ApiErrorCode } from '@shared/types'

type ExpectedStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429

/** A failure the caller caused and can act on. Carries a stable code. */
export class ExpectedError extends Error {
  constructor(
    readonly code: Exclude<ApiErrorCode, 'internal_error'>,
    readonly status: ExpectedStatus,
    message: string,
  ) {
    super(message)
  }
}

export class AuthenticationRequiredError extends ExpectedError {
  constructor() {
    super('authentication_required', 401, 'Authentication required.')
  }
}

export class InvalidCredentialError extends ExpectedError {
  constructor(message = 'Invalid credential.') {
    super('invalid_credential', 401, message)
  }
}

export class ForbiddenError extends ExpectedError {
  constructor(message: string) {
    super('forbidden', 403, message)
  }
}

export class InvalidRequestError extends ExpectedError {
  constructor(message: string) {
    super('invalid_request', 400, message)
  }
}

export class InvalidCursorError extends ExpectedError {
  constructor() {
    super('invalid_cursor', 400, 'Invalid pagination cursor.')
  }
}

export class NotFoundError extends ExpectedError {
  constructor(message: string) {
    super('not_found', 404, message)
  }
}

export class ConflictError extends ExpectedError {
  constructor(message: string) {
    super('conflict', 409, message)
  }
}

/** The request body names something that does not exist or cannot be used that way. */
export class InvalidReferenceError extends ExpectedError {
  constructor(message: string) {
    super('invalid_reference', 422, message)
  }
}

export class RateLimitedError extends ExpectedError {
  constructor(message: string) {
    super('rate_limited', 429, message)
  }
}

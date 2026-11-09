export type ApiErrorCode = 'authentication_required' | 'invalid_credential' | 'invalid_request' | 'invalid_cursor'

export class ExpectedError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: 400 | 401,
    message: string,
  ) {
    super(message)
  }
}

export class InvalidCredentialError extends ExpectedError {
  constructor(message = 'Invalid credential.') {
    super('invalid_credential', 401, message)
  }
}

export class InvalidCursorError extends ExpectedError {
  constructor() {
    super('invalid_cursor', 400, 'Invalid pagination cursor.')
  }
}

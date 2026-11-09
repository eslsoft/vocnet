import { describe, expect, it } from 'vitest'
import {
  AuthenticationRequiredError,
  ConflictError,
  ForbiddenError,
  InvalidCredentialError,
  InvalidCursorError,
  InvalidReferenceError,
  InvalidRequestError,
  NotFoundError,
} from './errors'

describe('expected errors', () => {
  it('carry stable codes and statuses', () => {
    expect(
      [
        new AuthenticationRequiredError(),
        new InvalidCredentialError(),
        new ForbiddenError('f'),
        new InvalidRequestError('r'),
        new InvalidCursorError(),
        new NotFoundError('n'),
        new ConflictError('c'),
        new InvalidReferenceError('i'),
      ].map(({ code, status }) => [code, status]),
    ).toEqual([
      ['authentication_required', 401],
      ['invalid_credential', 401],
      ['forbidden', 403],
      ['invalid_request', 400],
      ['invalid_cursor', 400],
      ['not_found', 404],
      ['conflict', 409],
      ['invalid_reference', 422],
    ])
  })
})

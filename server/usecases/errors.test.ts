import { describe, expect, it } from 'vitest'
import {
  AuthenticationRequiredError,
  ConflictError,
  CuratedFactError,
  ForbiddenError,
  InvalidCredentialError,
  InvalidCursorError,
  InvalidReferenceError,
  InvalidRequestError,
  InventorySettledError,
  NotFoundError,
  RateLimitedError,
  RejectedBeforeError,
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
        new CuratedFactError('cf'),
        new RejectedBeforeError('rb'),
        new InventorySettledError('is'),
        new RateLimitedError('rl', 60),
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
      ['curated_fact', 403],
      ['rejected_before', 409],
      ['inventory_settled', 403],
      ['rate_limited', 429],
    ])
    expect(new RateLimitedError('rl', 60).retryAfter).toBe(60)
  })
})

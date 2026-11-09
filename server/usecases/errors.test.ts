import { describe, expect, it } from 'vitest'
import { InvalidCredentialError, InvalidCursorError } from './errors'

describe('expected errors', () => {
  it('carries stable transport metadata', () => {
    expect(new InvalidCredentialError()).toMatchObject({ code: 'invalid_credential', status: 401 })
    expect(new InvalidCursorError()).toMatchObject({ code: 'invalid_cursor', status: 400 })
  })
})

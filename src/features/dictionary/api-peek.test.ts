import { describe, expect, it } from 'vitest'
import { curlCommand } from './api-peek'

describe('curlCommand', () => {
  it('repeats the read, narrowed with jq to the slice a block shows', () => {
    const origin = window.location.origin
    expect(curlCommand('/v1/sources')).toBe(`curl -s '${origin}/v1/sources'`)
    expect(curlCommand('/v1/entries/a?lang=zh', ['meanings', 0])).toBe(
      `curl -s '${origin}/v1/entries/a?lang=zh' | jq '.meanings[0]'`,
    )
    expect(curlCommand('/v1/entries/a?lang=zh', ['meanings', 0], ['pos', 'cefr'])).toBe(
      `curl -s '${origin}/v1/entries/a?lang=zh' | jq '.meanings[0] | {pos, cefr}'`,
    )
  })
})

import type { RateLimiter } from '@server/usecases/ports'

export function createRateLimiter(binding: RateLimit): RateLimiter {
  return {
    async allow(key) {
      const { success } = await binding.limit({ key })
      return success
    },
  }
}

import type { Env } from '@server/env'
import type { MediaStore } from '@server/usecases/ports'

/** Media files in an R2 bucket, each under its content id with its content type. */
export function createMediaStore(bucket: Env['MEDIA']): MediaStore {
  return {
    async put(id, bytes, contentType) {
      if (await bucket.head(id)) return
      await bucket.put(id, bytes, { httpMetadata: { contentType } })
    },

    async has(id) {
      return (await bucket.head(id)) !== null
    },

    async get(id) {
      const object = await bucket.get(id)
      if (!object) return null
      const contentType = object.httpMetadata?.contentType
      if (!contentType) throw new Error(`The media file ${id} was stored without a content type.`)
      return { body: object.body, contentType, size: object.size }
    },
  }
}

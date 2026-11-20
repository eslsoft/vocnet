import { createRoute } from '@hono/zod-openapi'
import { readMedia } from '@server/usecases/media'
import { mediaIdSchema } from '@shared/media'
import { z } from 'zod'
import { MEDIA_CACHE, notModified } from './caching'
import { createRouter, errorResponse, notModifiedResponse } from './router'

const getMedia = createRoute({
  method: 'get',
  path: '/media/{id}',
  tags: ['Media'],
  summary: 'Get a media file',
  description:
    'A picture or other media file by the SHA-256 of its bytes, as a topic image_url names it. The file under an id never ' +
    'changes, so it is cacheable forever; its ETag is the id. An id no file has is 404.',
  request: { params: z.object({ id: mediaIdSchema }) },
  responses: {
    200: {
      content: { 'image/webp': { schema: z.string().meta({ format: 'binary' }) } },
      description: 'The file, with its content type.',
    },
    304: notModifiedResponse,
    400: errorResponse,
    404: errorResponse,
  },
})

export const mediaRoutes = createRouter().openapi(getMedia, async (c) => {
  const { id } = c.req.valid('param')
  const file = await readMedia(c.get('deps'), id)
  const unchanged = notModified(c, `"${id}"`, MEDIA_CACHE)
  if (unchanged) {
    await file.body.cancel()
    return unchanged
  }
  c.header('Content-Type', file.contentType)
  c.header('Content-Length', String(file.size))
  return c.body(file.body, 200)
})

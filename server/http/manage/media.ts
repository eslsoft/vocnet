import { createRoute } from '@hono/zod-openapi'
import { storePicture } from '@server/usecases/media'
import { pictureUploadResultSchema } from '@shared/media'
import { z } from 'zod'
import { createRouter, errorResponse, json } from '../router'

const postMedia = createRoute({
  method: 'post',
  path: '/media',
  tags: ['Media'],
  summary: 'Store a picture',
  description:
    'The body is the picture itself: a 1024×1024 WebP of at most 300 KB (400 otherwise). It is stored under the SHA-256 ' +
    'of its bytes, which the answer gives as its id; an image fact names it by that id. Storing the same picture ' +
    'again changes nothing, and GET /v1/media/{id} serves it.',
  request: {
    body: { required: true, content: { 'image/webp': { schema: z.string().meta({ format: 'binary' }) } } },
  },
  responses: {
    200: json(pictureUploadResultSchema, 'The stored picture.'),
    400: errorResponse,
  },
})

export const manageMediaRoutes = createRouter().openapi(postMedia, async (c) =>
  c.json(await storePicture(c.get('deps'), new Uint8Array(await c.req.arrayBuffer())), 200),
)

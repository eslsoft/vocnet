import { createRoute } from '@hono/zod-openapi'
import { setTopicImage } from '@server/usecases/topics'
import { topicIdSchema } from '@shared/facts'
import { topicImageResultSchema } from '@shared/media'
import { z } from 'zod'
import { actorOf } from '../auth'
import { createRouter, errorResponse, json } from '../router'

const putImage = createRoute({
  method: 'put',
  path: '/topics/{id}/image',
  tags: ['Topics'],
  summary: 'Set the picture of a category or topic (curators)',
  description:
    'The body is the picture itself: a 1024×1024 WebP of at most 300 KB (400 otherwise). It is stored under the SHA-256 ' +
    'of its bytes and replaces the picture the topic showed; GET /v1/topics serves its image_url. Setting the same ' +
    'picture again changes nothing. An unknown topic id is 404.',
  request: {
    params: z.object({ id: topicIdSchema }),
    body: { required: true, content: { 'image/webp': { schema: z.string().meta({ format: 'binary' }) } } },
  },
  responses: {
    200: json(topicImageResultSchema, 'The picture the topic now shows.'),
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
})

export const manageTopicRoutes = createRouter().openapi(putImage, async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  return c.json(await setTopicImage(c.get('deps'), actorOf(c), c.req.valid('param').id, bytes), 200)
})

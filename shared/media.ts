import { z } from 'zod'

// Media on the wire. A media file is stored once under the SHA-256 of its bytes, so its id names its
// content and its URL can be cached forever.

export const mediaIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .meta({ description: 'The lowercase hex SHA-256 of the file.' })
export type MediaId = z.infer<typeof mediaIdSchema>

/** Where a media file is read publicly: its id under the media base. */
export const mediaUrl = (base: string, id: MediaId) => `${base}/${id}`

export const pictureUploadResultSchema = z
  .object({
    id: mediaIdSchema,
    url: z.string().meta({ description: 'The URL of the picture under the configured media base, cacheable forever.' }),
  })
  .meta({ id: 'PictureUpload', description: 'A stored picture: name it by id in an image fact.' })
export type PictureUploadResult = z.infer<typeof pictureUploadResultSchema>

export const topicImageResultSchema = z
  .object({
    topic_id: z.string(),
    image_url: z
      .string()
      .meta({ description: 'The URL of the image under the configured media base, cacheable forever.' }),
  })
  .meta({ id: 'TopicImageResult', description: 'The image a topic now shows.' })
export type TopicImageResult = z.infer<typeof topicImageResultSchema>

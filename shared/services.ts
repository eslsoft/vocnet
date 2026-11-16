import { z } from 'zod'

export const serviceIdSchema = z.uuid().brand<'ServiceId'>()
export type ServiceId = z.infer<typeof serviceIdSchema>

export const serviceSchema = z
  .object({
    id: serviceIdSchema,
    name: z.string(),
    created_by: z.string(),
    created_at: z.iso.datetime(),
    revoked_at: z.iso.datetime().nullable(),
  })
  .meta({
    id: 'Service',
    description: 'A downstream service that reads the public API with its own key, under the per-service read limit.',
  })
export type ServiceDto = z.infer<typeof serviceSchema>

export const issueServiceInputSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .meta({ id: 'IssueServiceInput' })
export type IssueServiceInput = z.infer<typeof issueServiceInputSchema>

export const issuedServiceSchema = z
  .object({
    service: serviceSchema,
    key: z.string().meta({ description: 'The service key. Shown once; only its SHA-256 hash is stored.' }),
  })
  .meta({ id: 'IssuedService' })

export const serviceListSchema = z.object({ items: z.array(serviceSchema) }).meta({ id: 'ServiceList' })

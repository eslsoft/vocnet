import { z } from 'zod'

export const agentIdSchema = z.uuid().brand<'AgentId'>()
export type AgentId = z.infer<typeof agentIdSchema>

export const agentSchema = z
  .object({
    id: agentIdSchema,
    name: z.string(),
    curator: z.boolean().meta({
      description: 'A curator settles facts and writes published ones itself, without the reviewer chain.',
    }),
    created_by: z.string(),
    created_at: z.iso.datetime(),
    revoked_at: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Agent' })
export type AgentDto = z.infer<typeof agentSchema>

export const issueAgentInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    curator: z.boolean().default(false).meta({ description: 'Grant the curator capability; producers never get it.' }),
  })
  .meta({ id: 'IssueAgentInput' })
export type IssueAgentInput = z.infer<typeof issueAgentInputSchema>

export const issuedAgentSchema = z
  .object({
    agent: agentSchema,
    key: z.string().meta({ description: 'The API key. Shown once; only its SHA-256 hash is stored.' }),
  })
  .meta({ id: 'IssuedAgent' })

export const agentListSchema = z.object({ items: z.array(agentSchema) }).meta({ id: 'AgentList' })

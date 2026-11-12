import type { EntryId } from '@shared/facts'
import {
  type WorkAttemptOutcome,
  type WorkWindow,
  workAttemptPageSchema,
  workItemDetailSchema,
  workItemOverviewListSchema,
  workSummarySchema,
} from '@shared/monitor'
import type { SettleSlotInput, WorkItemId, WorkType } from '@shared/work'
import { decodeApiResponse, expectNoContent, rpc } from '@/shared/api/client'

const work = rpc.manage.v1.work

export async function getWorkSummary(window: WorkWindow) {
  return decodeApiResponse(await work.summary.$get({ query: { window } }), workSummarySchema)
}

export interface AttemptFilter {
  outcome?: WorkAttemptOutcome
  type?: WorkType
  holder?: string
  lemma?: string
}

export async function listAttempts(filter: AttemptFilter, cursor: string | undefined) {
  const response = await work.attempts.$get({ query: { ...filter, cursor, limit: '25' } })
  return decodeApiResponse(response, workAttemptPageSchema)
}

/** The open tasks of an entry (its own and its senses'), or of one subject such as a flagged fact. */
export type TaskScope = { entry_id: string } | { subject_id: string }

export async function listTasks(scope: TaskScope) {
  return decodeApiResponse(await work.items.$get({ query: scope }), workItemOverviewListSchema)
}

export async function getTask(id: WorkItemId) {
  return decodeApiResponse(await work.items[':id'].$get({ param: { id } }), workItemDetailSchema)
}

/** A curator settles a slot nothing can fill, so its task closes. */
export async function settleSlot(entryId: EntryId, input: SettleSlotInput) {
  await expectNoContent(await rpc.manage.v1.entries[':id'].passes.$post({ param: { id: entryId }, json: input }))
}

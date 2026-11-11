import { memberPageSchema } from '@shared/catalog'
import type { RelationDomain } from '@shared/facts'
import { topicSensePageSchema, topicTreeSchema } from '@shared/topics'
import { decodeApiResponse, rpc } from '@/shared/api/client'

const LANG = 'zh'
const TOPIC_PAGE = '40'
/** Members come nearest first, so one page holds every direct kind of all but the largest categories. */
const MEMBER_PAGE = '100'

export async function getTopicTree() {
  return decodeApiResponse(await rpc.v1.topics.$get(), topicTreeSchema)
}

export async function listTopicSenses(topic: string, cursor: string | undefined) {
  const response = await rpc.v1.topics[':id'].senses.$get({
    param: { id: topic },
    query: { sort: 'frequency', lang: LANG, limit: TOPIC_PAGE, cursor },
  })
  return decodeApiResponse(response, topicSensePageSchema)
}

export async function listMembers(senseId: string, domain: RelationDomain | undefined, cursor: string | undefined) {
  const response = await rpc.v1.senses[':id'].members.$get({
    param: { id: senseId },
    query: { domain, lang: LANG, limit: MEMBER_PAGE, cursor },
  })
  return decodeApiResponse(response, memberPageSchema)
}

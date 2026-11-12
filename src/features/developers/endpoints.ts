import {
  entryPageSchema,
  formLookupSchema,
  memberPageSchema,
  publicEntrySchema,
  publicSenseDetailSchema,
  searchPageSchema,
} from '@shared/catalog'
import { referenceSourceListSchema } from '@shared/reference'
import { feedbackReceiptSchema } from '@shared/tickets'
import { topicSensePageSchema, topicTreeSchema } from '@shared/topics'
import { apiErrorSchema } from '@shared/types'
import type { z } from 'zod'

export { apiErrorSchema }

export interface EndpointParam {
  name: string
  in: 'path' | 'query'
  /** The value Try it starts with; `{sense}` stands for a real sense id read at run time. */
  example: string
}

export interface Endpoint {
  id: string
  method: 'GET' | 'POST'
  path: string
  params: EndpointParam[]
  /** The schema of the 2xx body, which Try it checks the response against. */
  schema: z.ZodType
  /** A POST writes data, so the guide shows it without running it. */
  tryable: boolean
}

const lang = (example = 'zh'): EndpointParam => ({ name: 'lang', in: 'query', example })
const page = (limit = '5'): EndpointParam[] => [
  { name: 'limit', in: 'query', example: limit },
  { name: 'cursor', in: 'query', example: '' },
]

export const ENDPOINTS: Endpoint[] = [
  {
    id: 'get-entry',
    method: 'GET',
    path: '/v1/entries/{lemma}',
    params: [
      { name: 'lemma', in: 'path', example: 'animal' },
      lang(),
      { name: 'domain', in: 'query', example: '' },
      { name: 'include', in: 'query', example: '' },
    ],
    schema: publicEntrySchema,
    tryable: true,
  },
  {
    id: 'search',
    method: 'GET',
    path: '/v1/search',
    params: [{ name: 'q', in: 'query', example: 'bird' }, lang(), ...page()],
    schema: searchPageSchema,
    tryable: true,
  },
  {
    id: 'list-entries',
    method: 'GET',
    path: '/v1/entries',
    params: [
      { name: 'prefix', in: 'query', example: '' },
      { name: 'level', in: 'query', example: 'A1' },
      { name: 'pos', in: 'query', example: 'noun' },
      { name: 'topic', in: 'query', example: '' },
      { name: 'sort', in: 'query', example: 'frequency' },
      lang(),
      ...page(),
    ],
    schema: entryPageSchema,
    tryable: true,
  },
  {
    id: 'get-form',
    method: 'GET',
    path: '/v1/forms/{form}',
    params: [{ name: 'form', in: 'path', example: 'birds' }, lang()],
    schema: formLookupSchema,
    tryable: true,
  },
  {
    id: 'get-sense',
    method: 'GET',
    path: '/v1/senses/{id}',
    params: [{ name: 'id', in: 'path', example: '{sense}' }, lang(), { name: 'domain', in: 'query', example: '' }],
    schema: publicSenseDetailSchema,
    tryable: true,
  },
  {
    id: 'list-members',
    method: 'GET',
    path: '/v1/senses/{id}/members',
    params: [
      { name: 'id', in: 'path', example: '{sense}' },
      { name: 'domain', in: 'query', example: '' },
      lang(),
      ...page('10'),
    ],
    schema: memberPageSchema,
    tryable: true,
  },
  { id: 'topics', method: 'GET', path: '/v1/topics', params: [], schema: topicTreeSchema, tryable: true },
  {
    id: 'topic-senses',
    method: 'GET',
    path: '/v1/topics/{id}/senses',
    params: [
      { name: 'id', in: 'path', example: 'wild-animals' },
      { name: 'sort', in: 'query', example: 'frequency' },
      lang(),
      ...page(),
    ],
    schema: topicSensePageSchema,
    tryable: true,
  },
  { id: 'sources', method: 'GET', path: '/v1/sources', params: [], schema: referenceSourceListSchema, tryable: true },
  { id: 'feedback', method: 'POST', path: '/v1/feedback', params: [], schema: feedbackReceiptSchema, tryable: false },
]

/** The request path with path parameters filled in and the non-empty query parameters appended. */
export function requestPath(endpoint: Endpoint, values: Record<string, string>): string {
  let path = endpoint.path
  const query = new URLSearchParams()
  for (const param of endpoint.params) {
    const value = (values[param.name] ?? '').trim()
    if (param.in === 'path') path = path.replace(`{${param.name}}`, encodeURIComponent(value))
    else if (value) query.set(param.name, value)
  }
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

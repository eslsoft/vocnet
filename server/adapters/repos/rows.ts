import type { createDb } from '@server/db/client'
import { type FactRow, type FeedbackRow, facts } from '@server/db/schema'
import type { Fact } from '@server/domain/fact'
import { factKinds } from '@server/domain/fact-kinds'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import type { PrincipalRef } from '@server/domain/principal'
import type { Lemma } from '@server/domain/term'
import { ConflictError, InvalidCursorError } from '@server/usecases/errors'
import {
  type EntryId,
  type FactId,
  factIdSchema,
  factKindSchema,
  factPayloadSchemas,
  factStatusSchema,
  posSchema,
  reviewSchema,
  type SenseId,
} from '@shared/facts'
import { type FeedbackId, feedbackStatusSchema, feedbackTargetTypeSchema } from '@shared/feedback'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

export type Db = ReturnType<typeof createDb>

/** Literal, not bound, so SQLite matches it against the partial unique index predicate. */
export const liveStatus = sql`${facts.status} in ('pending', 'published')`

// Stored rows are external data: each is parsed into its domain shape here, so
// nothing past the repos sees JSON text or unchecked enums.

export const toEntry = (row: { id: string; lemma: string; createdBy: string; createdAt: string }): EntryNode => ({
  id: row.id as EntryId,
  lemma: row.lemma as Lemma,
  createdBy: row.createdBy as PrincipalRef,
  createdAt: row.createdAt,
})

export const toSense = (row: {
  id: string
  entryId: string
  pos: string
  createdBy: string
  createdAt: string
}): SenseNode => ({
  id: row.id as SenseId,
  entryId: row.entryId as EntryId,
  pos: posSchema.parse(row.pos),
  createdBy: row.createdBy as PrincipalRef,
  createdAt: row.createdAt,
})

export function toFact(row: FactRow): Fact {
  const kind = factKindSchema.parse(row.kind)
  return {
    id: row.id as FactId,
    kind,
    subjectId: row.subjectId as EntryId | SenseId,
    objectId: row.objectId as SenseId | null,
    contentKey: row.contentKey,
    payload: factPayloadSchemas[kind].parse(JSON.parse(row.payload)),
    status: factStatusSchema.parse(row.status),
    supersedesId: row.supersedesId as FactId | null,
    author: row.author as PrincipalRef,
    review: row.review === null ? null : reviewSchema.parse(JSON.parse(row.review)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as Fact
}

export function fromFact(fact: Fact): FactRow {
  return {
    ...fact,
    exclusive: factKinds[fact.kind].cardinality === 'one',
    payload: JSON.stringify(fact.payload),
    review: fact.review && JSON.stringify(fact.review),
  }
}

function isUniqueViolation(error: unknown, table: string): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (cause.message.includes(`UNIQUE constraint failed: ${table}.`)) return true
  }
  return false
}

/** Runs a write whose unique indexes guard a domain invariant; a violation is a conflict, not a crash. */
export async function guardUnique<T>(table: string, message: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (isUniqueViolation(error, table)) throw new ConflictError(message)
    throw error
  }
}

export function toFeedback(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id as FeedbackId,
    targetType: feedbackTargetTypeSchema.parse(row.targetType),
    targetId: row.targetId,
    message: row.message,
    status: feedbackStatusSchema.parse(row.status),
    assignee: row.assignee as PrincipalRef | null,
    claimExpiresAt: row.claimExpiresAt,
    resolutionNote: row.resolutionNote,
    resolutionFactIds: z.array(factIdSchema).parse(JSON.parse(row.resolutionFactIds)),
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function fromFeedback(item: FeedbackRecord): FeedbackRow {
  return { ...item, resolutionFactIds: JSON.stringify(item.resolutionFactIds) }
}

// Opaque keyset cursors: base64url JSON of the ordering key, including a unique tiebreaker.
export function encodeCursor(key: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(key))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeCursor<T extends z.ZodType>(cursor: string, schema: T): z.infer<T> {
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'))
    const text = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
    return schema.parse(JSON.parse(text))
  } catch {
    // Any undecodable cursor is the client's mistake, never a reason to start over.
    throw new InvalidCursorError()
  }
}

export function page<T, R>(rows: R[], limit: number, map: (row: R) => T, key: (row: R) => Record<string, string>) {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return { items: items.map(map), nextCursor: rows.length > limit && last ? encodeCursor(key(last)) : null }
}

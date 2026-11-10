import { entries, publicEntries, publicForms, publicSenseTopics, senses, worklist } from '@server/db/schema'
import type { Lemma } from '@server/domain/term'
import type { PublicViewRepo, StaleView, ViewLookup } from '@server/usecases/ports'
import { type EntryId, type FactId, posSchema, type SenseId } from '@shared/facts'
import { and, asc, count, eq, exists, gt, gte, inArray, lt, ne, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Db, decodeCursor, page } from './rows'
import { relatedWorklistRows } from './work'

const PREFIX_END = '\u{10FFFF}'
const entryCursor = z.object({ lemma: z.string() })
const senseCursor = z.object({ lemma: z.string(), id: z.string() })

const isStale = ne(worklist.revision, worklist.viewRevision)

/** Hex of the first 16 bytes of the document's SHA-256: an ETag that changes exactly when the document does. */
async function digestOf(json: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)))
  return [...hash.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const lookupColumns = {
  entryId: worklist.entryId,
  revision: worklist.revision,
  viewRevision: worklist.viewRevision,
  json: publicEntries.document,
  digest: publicEntries.digest,
}

function toLookup(row: {
  entryId: string
  revision: number
  viewRevision: number
  json: string | null
  digest: string | null
}): ViewLookup {
  return {
    stale: row.revision === row.viewRevision ? null : { entryId: row.entryId as EntryId, revision: row.revision },
    view: row.json === null || row.digest === null ? null : { json: row.json, digest: row.digest },
  }
}

const toStale = (row: { entryId: string; revision: number }): StaleView => ({
  entryId: row.entryId as EntryId,
  revision: row.revision,
})

export function createPublicViewRepo(db: Db): PublicViewRepo {
  /** The worklist row and view of the entry the key column matches, in one statement. */
  const lookup = async (
    from: typeof entries | typeof senses,
    where: SQL,
    entryId: typeof entries.id | typeof senses.entryId,
  ) => {
    const row = await db
      .select(lookupColumns)
      .from(from)
      .innerJoin(worklist, eq(worklist.entryId, entryId))
      .leftJoin(publicEntries, eq(publicEntries.entryId, entryId))
      .where(where)
      .get()
    return row ? toLookup(row) : null
  }

  return {
    findByLemma: (lemma) => lookup(entries, eq(entries.lemma, lemma), entries.id),

    findBySense: (id) => lookup(senses, eq(senses.id, id), senses.entryId),

    async findForms(contentKeys) {
      const rows = await db
        .select({ factId: publicForms.factId, json: publicEntries.document, digest: publicEntries.digest })
        .from(publicForms)
        .innerJoin(publicEntries, eq(publicEntries.entryId, publicForms.entryId))
        .where(inArray(publicForms.contentKey, contentKeys))
        .orderBy(asc(publicEntries.lemma), asc(publicForms.factId))
      return rows.map((row) => ({ factId: row.factId as FactId, view: { json: row.json, digest: row.digest } }))
    },

    async listEntries(prefix, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, entryCursor) : undefined
      const rows = await db
        .select({ id: publicEntries.entryId, lemma: publicEntries.lemma })
        .from(publicEntries)
        .where(
          and(
            prefix
              ? and(gte(publicEntries.lemma, prefix), lt(publicEntries.lemma, `${prefix}${PREFIX_END}`))
              : undefined,
            after ? gt(publicEntries.lemma, after.lemma) : undefined,
          ),
        )
        .orderBy(asc(publicEntries.lemma))
        .limit(limit + 1)
      // lemma is unique, so it is its own keyset tiebreaker.
      return page(
        rows,
        limit,
        (row) => ({ id: row.id as EntryId, lemma: row.lemma }),
        (row) => ({ lemma: row.lemma }),
      )
    },

    async listTaggedSenses(leaves, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, senseCursor) : undefined
      // A sense tagged with two leaves of one category has a row under each; distinct shows it once.
      const rows = await db
        .selectDistinct({
          id: publicSenseTopics.senseId,
          lemma: publicSenseTopics.lemma,
          pos: publicSenseTopics.pos,
          gloss: publicSenseTopics.gloss,
        })
        .from(publicSenseTopics)
        .where(
          and(
            inArray(publicSenseTopics.topicId, [...leaves]),
            after
              ? or(
                  gt(publicSenseTopics.lemma, after.lemma),
                  and(eq(publicSenseTopics.lemma, after.lemma), gt(publicSenseTopics.senseId, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(publicSenseTopics.lemma), asc(publicSenseTopics.senseId))
        .limit(limit + 1)
      return page(
        rows,
        limit,
        (row) => ({
          id: row.id as SenseId,
          lemma: row.lemma as Lemma,
          pos: posSchema.parse(row.pos),
          gloss: row.gloss,
        }),
        (row) => ({ lemma: row.lemma, id: row.id }),
      )
    },

    async listStale(nodeIds) {
      const rows = await db
        .select({ entryId: worklist.entryId, revision: worklist.revision })
        .from(worklist)
        .where(and(isStale, relatedWorklistRows(db, nodeIds)))
      return rows.map(toStale)
    },

    async listAnyStale(limit) {
      const rows = await db
        .select({ entryId: worklist.entryId, revision: worklist.revision })
        .from(worklist)
        .where(isStale)
        .orderBy(asc(worklist.entryId))
        .limit(limit)
      return rows.map(toStale)
    },

    async countStale() {
      const [row] = await db.select({ count: count() }).from(worklist).where(isStale)
      return row?.count ?? 0
    },

    async save(stale, record) {
      // One batch, each statement conditional on the revision the rebuild read: a write that bumped
      // it since leaves every row as it was, and its own refresh rebuilds the view.
      const current = exists(
        db
          .select({ one: sql`1` })
          .from(worklist)
          .where(and(eq(worklist.entryId, stale.entryId), eq(worklist.revision, stale.revision))),
      )
      const ofEntry = (column: typeof publicForms.entryId | typeof publicSenseTopics.entryId) =>
        and(eq(column, stale.entryId), current)
      const clear = [
        db.delete(publicForms).where(ofEntry(publicForms.entryId)),
        db.delete(publicSenseTopics).where(ofEntry(publicSenseTopics.entryId)),
      ] as const
      const markBuilt = db
        .update(worklist)
        .set({ viewRevision: stale.revision })
        .where(and(eq(worklist.entryId, stale.entryId), eq(worklist.revision, stale.revision)))

      if (!record) {
        await db.batch([
          db.delete(publicEntries).where(and(eq(publicEntries.entryId, stale.entryId), current)),
          ...clear,
          markBuilt,
        ])
        return
      }

      const json = JSON.stringify(record.document)
      const digest = await digestOf(json)
      const rows = (values: unknown[]) => sql`json_each(${JSON.stringify(values)})`
      const field = (name: string) => sql<string>`json_extract(value, ${`$.${name}`})`
      // The digest is unchanged when only feedback or work moved the revision; the row then stays
      // as built, so its built_at says when the document last changed.
      const upsert = db
        .insert(publicEntries)
        .select(
          db
            .select({
              entryId: sql`${stale.entryId}`.as('entry_id'),
              lemma: sql`${record.document.lemma}`.as('lemma'),
              document: sql`${json}`.as('document'),
              digest: sql`${digest}`.as('digest'),
              builtAt: sql`${new Date().toISOString()}`.as('built_at'),
            })
            .from(worklist)
            .where(and(eq(worklist.entryId, stale.entryId), eq(worklist.revision, stale.revision))),
        )
        .onConflictDoUpdate({
          target: publicEntries.entryId,
          set: {
            document: sql`excluded.document`,
            digest: sql`excluded.digest`,
            builtAt: sql`excluded.built_at`,
          },
          setWhere: ne(publicEntries.digest, sql`excluded.digest`),
        })
      const insertForms = db.insert(publicForms).select(
        db
          .select({
            contentKey: field('contentKey').as('content_key'),
            factId: field('factId').as('fact_id'),
            entryId: sql`${stale.entryId}`.as('entry_id'),
          })
          .from(rows(record.forms))
          .where(current),
      )
      const insertTopics = db.insert(publicSenseTopics).select(
        db
          .select({
            topicId: field('topicId').as('topic_id'),
            lemma: sql`${record.document.lemma}`.as('lemma'),
            senseId: field('senseId').as('sense_id'),
            entryId: sql`${stale.entryId}`.as('entry_id'),
            pos: field('pos').as('pos'),
            gloss: field('gloss').as('gloss'),
          })
          .from(rows(record.taggedSenses))
          .where(current),
      )
      await db.batch([upsert, ...clear, insertForms, insertTopics, markBuilt])
    },
  }
}

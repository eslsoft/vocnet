import {
  entries,
  publicEntries,
  publicForms,
  publicMorphemes,
  publicPhraseWords,
  publicSenseTopics,
  senses,
  worklist,
} from '@server/db/schema'
import type { StoredSenseSummary, StoredSummary } from '@server/domain/catalog-view'
import { readStored, STEM_ROLES } from '@server/domain/public-view'
import type { PublicViewRepo, StaleView, ViewLookup } from '@server/usecases/ports'
import { type EntryId, formTypeSchema, posSchema } from '@shared/facts'
import { and, asc, count, eq, exists, gt, gte, inArray, lt, ne, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
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
  /** The worklist row and view of the entry the key column matches. */
  const lookup = (
    from: typeof entries | typeof senses,
    where: SQL,
    entryId: typeof entries.id | typeof senses.entryId,
  ) =>
    db
      .select(lookupColumns)
      .from(from)
      .innerJoin(worklist, eq(worklist.entryId, entryId))
      .leftJoin(publicEntries, eq(publicEntries.entryId, entryId))
      .where(where)

  const self = alias(publicEntries, 'self')
  const own = alias(publicMorphemes, 'own')
  const other = alias(publicMorphemes, 'other')
  const stems = inArray(own.role, [...STEM_ROLES])

  return {
    async findByLemma(lemma) {
      // One batch: the view, and what the built views of other entries supply to it.
      const [rows, phrases, family, parts] = await db.batch([
        lookup(entries, eq(entries.lemma, lemma), entries.id),
        db
          .select({ summary: publicEntries.summary })
          .from(publicPhraseWords)
          .innerJoin(publicEntries, eq(publicEntries.entryId, publicPhraseWords.entryId))
          .where(eq(publicPhraseWords.word, lemma))
          .orderBy(asc(publicEntries.lemma)),
        db
          .selectDistinct({ lemma: publicEntries.lemma, summary: publicEntries.summary })
          .from(own)
          .innerJoin(self, and(eq(self.entryId, own.entryId), eq(self.lemma, lemma)))
          .innerJoin(other, and(eq(other.form, own.form), eq(other.role, own.role), ne(other.entryId, own.entryId)))
          .innerJoin(publicEntries, eq(publicEntries.entryId, other.entryId))
          .where(stems)
          .orderBy(asc(publicEntries.lemma)),
        db
          .selectDistinct({ form: own.form })
          .from(own)
          .innerJoin(self, and(eq(self.entryId, own.entryId), eq(self.lemma, lemma)))
          .innerJoin(publicEntries, eq(publicEntries.lemma, own.form)),
      ])
      const [row] = rows
      if (!row) return null
      return {
        ...toLookup(row),
        links: {
          phrases: phrases.map((item) => readStored<StoredSummary>(item.summary)),
          family: family.map((item) => readStored<StoredSummary>(item.summary)),
          publicParts: parts.map((item) => item.form),
        },
      }
    },

    async findBySense(id) {
      const row = await lookup(senses, eq(senses.id, id), senses.entryId).get()
      return row ? toLookup(row) : null
    },

    async findForms(contentKeys) {
      const rows = await db
        .select({
          summary: publicEntries.summary,
          digest: publicEntries.digest,
          type: publicForms.type,
          pos: publicForms.pos,
        })
        .from(publicForms)
        .innerJoin(publicEntries, eq(publicEntries.entryId, publicForms.entryId))
        .where(inArray(publicForms.contentKey, contentKeys))
        .orderBy(asc(publicEntries.lemma), asc(publicForms.type), asc(publicForms.pos))
      return rows.map((row) => ({
        summary: readStored<StoredSummary>(row.summary),
        digest: row.digest,
        type: formTypeSchema.parse(row.type),
        pos: row.pos === null ? null : posSchema.parse(row.pos),
      }))
    },

    async listEntries(prefix, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, entryCursor) : undefined
      const rows = await db
        .select({ lemma: publicEntries.lemma, summary: publicEntries.summary })
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
        (row) => readStored<StoredSummary>(row.summary),
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
          summary: publicSenseTopics.summary,
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
        (row) => readStored<StoredSenseSummary>(row.summary),
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
      const ofEntry = (
        column:
          | typeof publicForms.entryId
          | typeof publicSenseTopics.entryId
          | typeof publicPhraseWords.entryId
          | typeof publicMorphemes.entryId,
      ) => and(eq(column, stale.entryId), current)
      const clear = [
        db.delete(publicForms).where(ofEntry(publicForms.entryId)),
        db.delete(publicSenseTopics).where(ofEntry(publicSenseTopics.entryId)),
        db.delete(publicPhraseWords).where(ofEntry(publicPhraseWords.entryId)),
        db.delete(publicMorphemes).where(ofEntry(publicMorphemes.entryId)),
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
              summary: sql`${JSON.stringify(record.document.summary)}`.as('summary'),
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
            summary: sql`excluded.summary`,
            builtAt: sql`excluded.built_at`,
          },
          setWhere: ne(publicEntries.digest, sql`excluded.digest`),
        })
      const insertForms = db.insert(publicForms).select(
        db
          .select({
            contentKey: field('contentKey').as('content_key'),
            entryId: sql`${stale.entryId}`.as('entry_id'),
            type: field('type').as('type'),
            pos: field('pos').as('pos'),
          })
          .from(rows(record.forms))
          .where(current),
      )
      const insertTopics = db.insert(publicSenseTopics).select(
        db
          .select({
            topicId: field('topicId').as('topic_id'),
            lemma: sql`${record.document.lemma}`.as('lemma'),
            senseId: field('summary.sense_id').as('sense_id'),
            entryId: sql`${stale.entryId}`.as('entry_id'),
            summary: sql<string>`json(json_extract(value, '$.summary'))`.as('summary'),
          })
          .from(rows(record.taggedSenses))
          .where(current),
      )
      const insertPhraseWords = db.insert(publicPhraseWords).select(
        db
          .select({ word: sql<string>`value`.as('word'), entryId: sql`${stale.entryId}`.as('entry_id') })
          .from(rows(record.phraseWords))
          .where(current),
      )
      const insertMorphemes = db.insert(publicMorphemes).select(
        db
          .select({
            form: field('form').as('form'),
            role: field('role').as('role'),
            entryId: sql`${stale.entryId}`.as('entry_id'),
          })
          .from(rows(record.morphemes))
          .where(current),
      )
      await db.batch([upsert, ...clear, insertForms, insertTopics, insertPhraseWords, insertMorphemes, markBuilt])
    },
  }
}

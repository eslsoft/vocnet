import {
  entries,
  publicEntries,
  publicForms,
  publicHypernyms,
  publicMeanings,
  publicMorphemes,
  publicPhraseWords,
  publicSearch,
  publicSenseTopics,
  senses,
  worklist,
} from '@server/db/schema'
import type { StoredSenseSummary, StoredSummary } from '@server/domain/catalog-view'
import { readStored, STEM_ROLES } from '@server/domain/public-view'
import { EXACT_LEMMA_TIER, fieldTier, LEMMA_PREFIX_TIER, SEARCH_FIELDS, SEARCH_TIERS } from '@server/domain/search'
import type {
  EntryFilter,
  PageRequest,
  PublicViewRepo,
  SearchQuery,
  StaleView,
  ViewLookup,
} from '@server/usecases/ports'
import type { EntrySort, SenseSort } from '@shared/catalog'
import { type EntryId, formTypeSchema, posSchema, type RelationDomain, type SenseId, type TopicId } from '@shared/facts'
import { and, asc, count, eq, exists, gte, inArray, lt, ne, type SQL, sql } from 'drizzle-orm'
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { type Db, decodeCursor, page } from './rows'
import { relatedWorklistRows } from './work'

const PREFIX_END = '\u{10FFFF}'
const lemmaCursor = z.object({ lemma: z.string() })
const rankedLemmaCursor = z.object({ order: z.number().int(), lemma: z.string() })
const senseCursor = z.object({ lemma: z.string(), id: z.string() })
const rankedSenseCursor = z.object({ order: z.number().int(), lemma: z.string(), id: z.string() })
const searchCursor = z.object({ tier: z.number().int(), order: z.number().int(), lemma: z.string() })
const memberCursor = z.object({ depth: z.number().int(), lemma: z.string(), id: z.string() })

/**
 * How deep the members walk goes. The everyday taxonomy is a few levels deep and a domain one under
 * ten; the bound also ends a walk that a cycle of three or more entries would keep going.
 */
export const MEMBER_DEPTH = 12

/** The lemma starts with prefix: a range on the lemma index. */
const startsWith = (column: SQLiteColumn, prefix: string) =>
  and(gte(column, prefix), lt(column, `${prefix}${PREFIX_END}`))

/** A keyset condition: the row's sort key comes after the cursor's, compared as one row value. */
const after = (columns: SQLiteColumn[], values: Array<string | number>) =>
  sql`(${sql.join(columns, sql`, `)}) > (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`

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

/** The column a topic listing sorts by before lemma and sense; none for lemma order. */
const sortColumn: Record<SenseSort, SQLiteColumn | null> = {
  lemma: null,
  frequency: publicSenseTopics.frequencyOrder,
  level: publicSenseTopics.levelOrder,
}

/** FTS5 query syntax: each term a quoted string, all of them required. */
const ftsQuery = (terms: readonly string[]) => terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ')

/** The texts of public senses that hold every term, in the scopes searched, at the tier of their field. */
const textHits = (query: SearchQuery) => sql`
  UNION ALL
  SELECT public_search.entry_id,
    CASE public_search.field ${sql.join(
      SEARCH_FIELDS.map((field) => sql`WHEN ${field} THEN ${fieldTier(field)}`),
      sql` `,
    )} END
  FROM public_search_fts JOIN public_search ON public_search.id = public_search_fts.rowid
  WHERE public_search_fts MATCH ${ftsQuery(query.terms)}
    AND public_search.scope IN (${sql.join(
      query.scopes.map((scope) => sql`${scope}`),
      sql`, `,
    )})`

function tierMatch(tier: number) {
  const match = SEARCH_TIERS[tier]
  if (!match) throw new Error(`Search tier ${tier} has no match.`)
  return match
}

/**
 * The page query of `GET /v1/entries`: a range on the lemma index, or a walk of the frequency
 * index, with the filter checked per entry through the primary key of public_meanings or the
 * (entry_id, topic_id) index of public_sense_topics. Exported so a test can pin its query plan.
 */
export function entryListStatement(db: Db, filter: EntryFilter, sort: EntrySort, { limit, cursor }: PageRequest) {
  const { prefix, levels, pos, leaves } = filter
  const fits = (posColumn: SQLiteColumn, cefrColumn: SQLiteColumn) => [
    pos === null ? undefined : eq(posColumn, pos),
    levels.length > 0 ? inArray(cefrColumn, [...levels]) : undefined,
  ]
  // Topic, part of speech, and level hold for one tagged common sense, or without a topic for one
  // meaning. A topic on a rare sense does not put its entry in the topic's word list.
  const restriction = leaves
    ? exists(
        db
          .select({ one: sql`1` })
          .from(publicSenseTopics)
          .where(
            and(
              eq(publicSenseTopics.entryId, publicEntries.entryId),
              inArray(publicSenseTopics.topicId, [...leaves]),
              eq(publicSenseTopics.rare, false),
              ...fits(publicSenseTopics.pos, publicSenseTopics.cefr),
            ),
          ),
      )
    : pos !== null || levels.length > 0
      ? exists(
          db
            .select({ one: sql`1` })
            .from(publicMeanings)
            .where(
              and(eq(publicMeanings.entryId, publicEntries.entryId), ...fits(publicMeanings.pos, publicMeanings.cefr)),
            ),
        )
      : undefined
  const keyColumns = sort === 'lemma' ? [publicEntries.lemma] : [publicEntries.frequencyOrder, publicEntries.lemma]
  const keyOf = (value: string) => {
    if (sort === 'lemma') return [decodeCursor(value, lemmaCursor).lemma]
    const { order, lemma } = decodeCursor(value, rankedLemmaCursor)
    return [order, lemma]
  }
  const last = cursor && keyOf(cursor)
  return db
    .select({ lemma: publicEntries.lemma, summary: publicEntries.summary, order: publicEntries.frequencyOrder })
    .from(publicEntries)
    .where(
      and(
        prefix ? startsWith(publicEntries.lemma, prefix) : undefined,
        restriction,
        last ? after(keyColumns, last) : undefined,
      ),
    )
    .orderBy(...keyColumns.map((column) => asc(column)))
    .limit(limit + 1)
}

/**
 * The page query of `GET /v1/topics/{id}/senses`: one index of public_sense_topics per sort,
 * each led by topic_id. Exported so a test can pin its query plan.
 */
export function taggedSenseStatement(
  db: Db,
  leaves: readonly TopicId[],
  sort: SenseSort,
  { limit, cursor }: PageRequest,
) {
  const orderColumn = sortColumn[sort]
  const keyColumns = [...(orderColumn ? [orderColumn] : []), publicSenseTopics.lemma, publicSenseTopics.senseId]
  const keyOf = (value: string) => {
    if (!orderColumn) {
      const { lemma, id } = decodeCursor(value, senseCursor)
      return [lemma, id]
    }
    const { order, lemma, id } = decodeCursor(value, rankedSenseCursor)
    return [order, lemma, id]
  }
  const last = cursor && keyOf(cursor)
  // A sense tagged with two leaves of one category has a row under each; distinct shows it once.
  return db
    .selectDistinct({
      id: publicSenseTopics.senseId,
      lemma: publicSenseTopics.lemma,
      order: sql<number>`${orderColumn ?? publicSenseTopics.frequencyOrder}`,
      summary: publicSenseTopics.summary,
    })
    .from(publicSenseTopics)
    .where(and(inArray(publicSenseTopics.topicId, [...leaves]), last ? after(keyColumns, last) : undefined))
    .orderBy(...keyColumns.map((column) => asc(column)))
    .limit(limit + 1)
}

/**
 * The page query of `GET /v1/search`: every entry the lemma index or the full-text index finds,
 * an entry whose spelling variant is the query ranking as its exact lemma, once at its best tier, then by frequency and lemma. Exported so a test can pin its query plan.
 */
export function searchStatement(query: SearchQuery, { limit, cursor }: PageRequest) {
  const last = cursor ? decodeCursor(cursor, searchCursor) : undefined
  return sql`
    WITH hits(entry_id, tier) AS (
      SELECT entry_id, ${EXACT_LEMMA_TIER} FROM public_entries WHERE lemma = ${query.text}
      UNION ALL
      SELECT entry_id, ${EXACT_LEMMA_TIER} FROM public_forms WHERE form = ${query.text} AND type = 'variant'
      UNION ALL
      SELECT entry_id, ${LEMMA_PREFIX_TIER} FROM public_entries
        WHERE lemma >= ${query.text} AND lemma < ${`${query.text}${PREFIX_END}`}
      ${query.terms.length > 0 ? textHits(query) : sql``}
    ),
    best(entry_id, tier) AS (SELECT entry_id, min(tier) FROM hits GROUP BY entry_id)
    SELECT public_entries.lemma AS lemma, public_entries.summary AS summary,
      public_entries.frequency_order AS "order", best.tier AS tier
    FROM best JOIN public_entries ON public_entries.entry_id = best.entry_id
    ${last ? sql`WHERE (best.tier, public_entries.frequency_order, public_entries.lemma) > (${last.tier}, ${last.order}, ${last.lemma})` : sql``}
    ORDER BY best.tier, public_entries.frequency_order, public_entries.lemma
    LIMIT ${limit + 1}
  `
}

/**
 * The page query of `GET /v1/senses/{id}/members`: a recursive walk down public_hypernyms from the
 * category, everyday links and those of the domain asked for, each member at its nearest depth.
 * Exported so a test can pin it.
 */
export function memberStatement(id: SenseId, domain: RelationDomain | null, { limit, cursor }: PageRequest) {
  const last = cursor ? decodeCursor(cursor, memberCursor) : undefined
  return sql`
    WITH RECURSIVE walk(sense_id, depth) AS (
      SELECT sense_id, 1 FROM public_hypernyms AS h
        WHERE h.broader_sense_id = ${id} AND (h.domain IS NULL OR h.domain = ${domain})
      UNION
      SELECT h.sense_id, walk.depth + 1 FROM public_hypernyms AS h JOIN walk ON h.broader_sense_id = walk.sense_id
        WHERE walk.depth < ${MEMBER_DEPTH} AND (h.domain IS NULL OR h.domain = ${domain})
    ),
    nearest(sense_id, depth) AS (SELECT sense_id, min(depth) FROM walk WHERE sense_id <> ${id} GROUP BY sense_id),
    members AS (
      SELECT nearest.sense_id AS id, nearest.depth AS depth,
        (SELECT lemma FROM public_hypernyms WHERE sense_id = nearest.sense_id LIMIT 1) AS lemma,
        (SELECT summary FROM public_hypernyms WHERE sense_id = nearest.sense_id LIMIT 1) AS summary
      FROM nearest
    )
    SELECT id, depth, lemma, summary FROM members
    ${last ? sql`WHERE (depth, lemma, id) > (${last.depth}, ${last.lemma}, ${last.id})` : sql``}
    ORDER BY depth, lemma, id
    LIMIT ${limit + 1}
  `
}

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

    async findForms(form) {
      const rows = await db
        .select({
          summary: publicEntries.summary,
          digest: publicEntries.digest,
          type: publicForms.type,
          pos: publicForms.pos,
        })
        .from(publicForms)
        .innerJoin(publicEntries, eq(publicEntries.entryId, publicForms.entryId))
        .where(eq(publicForms.form, form))
        .orderBy(asc(publicEntries.lemma), asc(publicForms.type), asc(publicForms.pos))
      return rows.map((row) => ({
        summary: readStored<StoredSummary>(row.summary),
        digest: row.digest,
        type: formTypeSchema.parse(row.type),
        pos: row.pos === null ? null : posSchema.parse(row.pos),
      }))
    },

    async listEntries(filter, sort, request) {
      const rows = await entryListStatement(db, filter, sort, request)
      return page(
        rows,
        request.limit,
        (row) => readStored<StoredSummary>(row.summary),
        // lemma is unique, so it is its own keyset tiebreaker.
        (row): Record<string, string | number> =>
          sort === 'lemma' ? { lemma: row.lemma } : { order: row.order, lemma: row.lemma },
      )
    },

    async listTaggedSenses(leaves, sort, request) {
      const rows = await taggedSenseStatement(db, leaves, sort, request)
      return page(
        rows,
        request.limit,
        (row) => readStored<StoredSenseSummary>(row.summary),
        (row): Record<string, string | number> =>
          sort === 'lemma' ? { lemma: row.lemma, id: row.id } : { order: row.order, lemma: row.lemma, id: row.id },
      )
    },

    async search(query, request) {
      const rows = await db.all<{ lemma: string; summary: string; order: number; tier: number }>(
        searchStatement(query, request),
      )
      return page(
        rows,
        request.limit,
        (row) => ({ summary: readStored<StoredSummary>(row.summary), match: tierMatch(row.tier) }),
        (row) => ({ tier: row.tier, order: row.order, lemma: row.lemma }),
      )
    },

    async listMembers(id, domain, request) {
      const rows = await db.all<{ id: string; depth: number; lemma: string; summary: string }>(
        memberStatement(id, domain, request),
      )
      return page(
        rows,
        request.limit,
        (row) => ({ summary: readStored<StoredSenseSummary>(row.summary), depth: row.depth }),
        (row) => ({ depth: row.depth, lemma: row.lemma, id: row.id }),
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
      const ofEntry = (column: SQLiteColumn) => and(eq(column, stale.entryId), current)
      const clear = [
        db.delete(publicMeanings).where(ofEntry(publicMeanings.entryId)),
        db.delete(publicForms).where(ofEntry(publicForms.entryId)),
        db.delete(publicSenseTopics).where(ofEntry(publicSenseTopics.entryId)),
        db.delete(publicHypernyms).where(ofEntry(publicHypernyms.entryId)),
        db.delete(publicPhraseWords).where(ofEntry(publicPhraseWords.entryId)),
        db.delete(publicMorphemes).where(ofEntry(publicMorphemes.entryId)),
        db.delete(publicSearch).where(ofEntry(publicSearch.entryId)),
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
              frequencyOrder: sql`${record.frequencyOrder}`.as('frequency_order'),
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
            frequencyOrder: sql`excluded.frequency_order`,
            builtAt: sql`excluded.built_at`,
          },
          setWhere: ne(publicEntries.digest, sql`excluded.digest`),
        })
      const insertMeanings = db.insert(publicMeanings).select(
        db
          .select({
            entryId: sql`${stale.entryId}`.as('entry_id'),
            pos: field('pos').as('pos'),
            cefr: field('cefr').as('cefr'),
          })
          .from(rows(record.meanings))
          .where(current),
      )
      const insertForms = db.insert(publicForms).select(
        db
          .select({
            form: field('form').as('form'),
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
            pos: field('summary.pos').as('pos'),
            cefr: field('summary.cefr').as('cefr'),
            levelOrder: field('levelOrder').as('level_order'),
            frequencyOrder: sql`${record.frequencyOrder}`.as('frequency_order'),
            summary: sql<string>`json(json_extract(value, '$.summary'))`.as('summary'),
            rare: field('rare').as('rare'),
          })
          .from(rows(record.taggedSenses))
          .where(current),
      )
      const insertHypernyms = db
        .insert(publicHypernyms)
        .select(
          db
            .select({
              broaderSenseId: field('broaderSenseId').as('broader_sense_id'),
              senseId: field('summary.sense_id').as('sense_id'),
              domain: field('domain').as('domain'),
              entryId: sql`${stale.entryId}`.as('entry_id'),
              lemma: sql`${record.document.lemma}`.as('lemma'),
              summary: sql<string>`json(json_extract(value, '$.summary'))`.as('summary'),
            })
            .from(rows(record.hypernyms))
            .where(current),
        )
        // The one-layer rule is a read before the write, so two concurrent submissions can give one
        // pair a hypernym in each layer; the walk lists the pair once.
        .onConflictDoNothing()
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
      const insertSearch = db.insert(publicSearch).select(
        db
          .select({
            // Null takes the next rowid, the key the search index stores.
            id: sql`null`.as('id'),
            entryId: sql`${stale.entryId}`.as('entry_id'),
            field: field('field').as('field'),
            scope: field('scope').as('scope'),
            body: field('body').as('body'),
          })
          .from(rows(record.searchTexts))
          .where(current),
      )
      await db.batch([
        upsert,
        ...clear,
        insertMeanings,
        insertForms,
        insertTopics,
        insertHypernyms,
        insertPhraseWords,
        insertMorphemes,
        insertSearch,
        markBuilt,
      ])
    },
  }
}

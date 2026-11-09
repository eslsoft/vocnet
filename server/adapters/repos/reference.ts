import { entries, lemmaCefr, referenceSources, wordFrequency } from '@server/db/schema'
import { frequencyKey } from '@server/domain/reference'
import type { Lemma } from '@server/domain/term'
import type { ReferenceRepo } from '@server/usecases/ports'
import { cefrSchema, frequencySchema, referenceSourceSchema } from '@shared/reference'
import { asc, eq, min, notExists, sql } from 'drizzle-orm'
import type { Db } from './rows'

export function createReferenceRepo(db: Db): ReferenceRepo {
  return {
    async forLemma(lemma) {
      const [frequency, cefr] = await db.batch([
        db
          .select()
          .from(wordFrequency)
          .where(eq(wordFrequency.word, frequencyKey(lemma))),
        db.select().from(lemmaCefr).where(eq(lemmaCefr.lemma, lemma)).orderBy(asc(lemmaCefr.level), asc(lemmaCefr.pos)),
      ])
      const [row] = frequency
      return {
        frequency: row ? frequencySchema.parse({ zipf: row.zipf, rank: row.rank, source_id: row.sourceId }) : null,
        cefr: cefr.map((item) => cefrSchema.parse({ pos: item.pos, level: item.level, source_id: item.sourceId })),
      }
    },

    async listSources() {
      const rows = await db.select().from(referenceSources).orderBy(asc(referenceSources.id))
      return rows.map(({ licenseUrl, retrievedAt, ...row }) =>
        referenceSourceSchema.parse({ ...row, license_url: licenseUrl, retrieved_at: retrievedAt }),
      )
    },

    async listCefrLemmasWithoutEntry() {
      const entry = db.select({ one: sql`1` }).from(entries).where(eq(entries.lemma, lemmaCefr.lemma))
      const rows = await db
        .select({ lemma: lemmaCefr.lemma })
        .from(lemmaCefr)
        .where(notExists(entry))
        .groupBy(lemmaCefr.lemma)
        .orderBy(min(lemmaCefr.level), asc(lemmaCefr.lemma))
      return rows.map((row) => row.lemma as Lemma)
    },
  }
}

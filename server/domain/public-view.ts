import type { FormMatch, PublicEntry, PublicSenseWithEntry } from '@shared/catalog'
import type { FactId, Pos, SenseId, TopicId } from '@shared/facts'
import type { LemmaReference } from '@shared/reference'
import { type EntrySnapshot, projectPublicEntry } from './catalog-view'
import { contentKeyOf } from './fact-kinds'

// The public view stores each entry's public document, built by the same projection that defines
// visibility, plus the lookup rows the other public reads need. Everything here derives from the
// document, so the view can never say more than the projection does.

/** The rows the public view stores for one entry. */
export interface PublicViewRecord {
  document: PublicEntry
  /** One per published form, under the form fact's content key, so a form lookup matches as the facts do. */
  forms: Array<{ contentKey: string; factId: FactId }>
  /** One per published topic tag of a public sense. */
  taggedSenses: Array<{ topicId: TopicId; senseId: SenseId; pos: Pos; gloss: string }>
}

/** The entry's public document: its published facts with the imported reference data; null when it is not public. */
export function publicEntryDocument(snapshot: EntrySnapshot, reference: LemmaReference): PublicEntry | null {
  const view = projectPublicEntry(snapshot)
  return view && { ...view, ...reference }
}

export function publicViewRecord(document: PublicEntry): PublicViewRecord {
  return {
    document,
    forms: document.forms.map((form) => ({
      contentKey: contentKeyOf('form', { form: form.form, type: form.type }),
      factId: form.id,
    })),
    taggedSenses: document.senses.flatMap((sense) =>
      sense.topics.map((tag) => ({ topicId: tag.topic_id, senseId: sense.id, pos: sense.pos, gloss: sense.gloss })),
    ),
  }
}

/** The stored document. It is the serialized DTO the view wrote, so it is read back as is. */
export function readDocument(json: string): PublicEntry {
  return JSON.parse(json) as PublicEntry
}

export function publicSenseOf(document: PublicEntry, senseId: SenseId): PublicSenseWithEntry | null {
  const sense = document.senses.find((candidate) => candidate.id === senseId)
  return sense ? { ...sense, entry: { id: document.id, lemma: document.lemma } } : null
}

/** The form fact as a lookup shows it. The view writes a form row only with the form in its document. */
export function formMatchOf(document: PublicEntry, factId: FactId): FormMatch {
  const form = document.forms.find((candidate) => candidate.id === factId)
  if (!form) throw new Error(`The public document of ${document.lemma} has no form ${factId}.`)
  return { entry: { id: document.id, lemma: document.lemma }, form }
}

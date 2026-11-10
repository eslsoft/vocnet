import type { ReadVariant } from '@server/domain/public-view'
import { getPublicEntry } from '@server/usecases/catalog'
import type { ViewDeps } from '@server/usecases/public-view'
import type { PublicEntry } from '@shared/catalog'

/** Every language with every review: the whole stored document. */
export const FULL: ReadVariant = { lang: 'all', review: true }

/** The public entry as the API serves it in this variant, every language and review by default. */
export async function publicEntryOf(deps: ViewDeps, lemma: string, variant: ReadVariant = FULL): Promise<PublicEntry> {
  return (await getPublicEntry(deps, lemma, variant)).read()
}

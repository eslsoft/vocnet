import { readDocument } from '@server/domain/public-view'
import { getPublicEntry } from '@server/usecases/catalog'
import type { ViewDeps } from '@server/usecases/public-view'
import type { PublicEntry } from '@shared/catalog'

/** The public entry as the API serves it, decoded. */
export async function publicEntryOf(deps: ViewDeps, lemma: string): Promise<PublicEntry> {
  return readDocument((await getPublicEntry(deps, lemma)).json)
}

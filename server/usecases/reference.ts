import type { ReferenceSource } from '@shared/reference'
import type { Deps } from './deps'

/** Every imported reference source with the license and attribution its data is shown under. */
export function listReferenceSources(deps: Pick<Deps, 'reference'>): Promise<ReferenceSource[]> {
  return deps.reference.listSources()
}

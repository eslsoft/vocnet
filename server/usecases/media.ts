import type { MediaId } from '@shared/media'
import type { Deps } from './deps'
import { NotFoundError } from './errors'
import type { MediaFile } from './ports'

/** A stored media file by its id; an id no file has is not found. */
export async function readMedia(deps: Pick<Deps, 'media'>, id: MediaId): Promise<MediaFile> {
  const file = await deps.media.get(id)
  if (!file) throw new NotFoundError(`No media file has the id ${id}.`)
  return file
}

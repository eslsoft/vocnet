import { mediaIdOf, pictureProblem, WEBP } from '@server/domain/media'
import { type MediaId, mediaUrl, type PictureUploadResult } from '@shared/media'
import type { Deps } from './deps'
import { InvalidRequestError, NotFoundError } from './errors'
import type { MediaFile } from './ports'

/** A stored media file by its id; an id no file has is not found. */
export async function readMedia(deps: Pick<Deps, 'media'>, id: MediaId): Promise<MediaFile> {
  const file = await deps.media.get(id)
  if (!file) throw new NotFoundError(`No media file has the id ${id}.`)
  return file
}

/**
 * Stores a picture under the SHA-256 of its bytes, or answers an invalid request naming why it is
 * not one (`pictureProblem`). Storing the same picture again changes nothing.
 */
export async function storePicture(
  deps: Pick<Deps, 'media' | 'mediaBaseUrl'>,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<PictureUploadResult> {
  const problem = pictureProblem(bytes)
  if (problem) throw new InvalidRequestError(problem)
  const id = await mediaIdOf(bytes)
  await deps.media.put(id, bytes, WEBP)
  return { id, url: mediaUrl(deps.mediaBaseUrl, id) }
}

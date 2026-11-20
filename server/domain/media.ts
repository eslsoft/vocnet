import type { MediaId } from '@shared/media'

/** The one format a picture is stored in. */
export const WEBP = 'image/webp'

/** What a topic's picture must be: a square WebP, small enough to load at once in a topic list. */
export const TOPIC_IMAGE = { side: 1024, maxBytes: 300 * 1024 } as const

/** The bytes a reader of the size needs: the RIFF header, the first chunk's header, and its size fields. */
const HEADER_BYTES = 30

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))

/**
 * The pixel size a WebP file declares in its first chunk (lossy `VP8 `, lossless `VP8L`, or the
 * extended `VP8X` canvas), or null when the bytes are not a WebP file.
 */
export function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < HEADER_BYTES || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES)
  const u24 = (at: number) => view.getUint16(at, true) | (view.getUint8(at + 2) << 16)
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ') {
    if (u24(23) !== 0x2a019d) return null
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    if (view.getUint8(20) !== 0x2f) return null
    const bits = view.getUint32(21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') return { width: u24(24) + 1, height: u24(27) + 1 }
  return null
}

/** Why the bytes cannot be a topic's picture, or null when they can. */
export function topicImageProblem(bytes: Uint8Array): string | null {
  if (bytes.length > TOPIC_IMAGE.maxBytes) {
    return `A topic image is at most ${TOPIC_IMAGE.maxBytes} bytes; this one is ${bytes.length}.`
  }
  const size = webpSize(bytes)
  if (!size) return 'A topic image is a WebP file.'
  if (size.width !== TOPIC_IMAGE.side || size.height !== TOPIC_IMAGE.side) {
    return `A topic image is ${TOPIC_IMAGE.side}×${TOPIC_IMAGE.side}; this one is ${size.width}×${size.height}.`
  }
  return null
}

/** The id a file is stored under: the lowercase hex SHA-256 of its bytes. */
export async function mediaIdOf(bytes: Uint8Array<ArrayBuffer>): Promise<MediaId> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

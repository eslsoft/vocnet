/**
 * The first bytes of a WebP file of the size given, as its encoder writes them: enough for a
 * reader of its header, padded with zeros to `length` bytes. Not a decodable picture.
 */
export function webpHeader(
  width: number,
  height: number,
  { chunk = 'VP8 ', length = 64 }: { chunk?: 'VP8 ' | 'VP8L' | 'VP8X'; length?: number } = {},
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.max(length, 30))
  const ascii = (at: number, text: string) =>
    bytes.set(
      [...text].map((char) => char.charCodeAt(0)),
      at,
    )
  const view = new DataView(bytes.buffer)
  ascii(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  ascii(8, 'WEBP')
  ascii(12, chunk)
  if (chunk === 'VP8 ') {
    bytes.set([0x9d, 0x01, 0x2a], 23)
    view.setUint16(26, width, true)
    view.setUint16(28, height, true)
  } else if (chunk === 'VP8L') {
    bytes[20] = 0x2f
    view.setUint32(21, ((width - 1) | ((height - 1) << 14)) >>> 0, true)
  } else {
    const u24 = (at: number, value: number) => bytes.set([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff], at)
    u24(24, width - 1)
    u24(27, height - 1)
  }
  return bytes
}

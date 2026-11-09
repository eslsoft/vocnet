// Pure business rule: zero outward imports.

const MAX_LENGTH = 500

/** Trims, collapses internal whitespace, and enforces note-text limits. */
export function normalizeNoteText(input: string): string {
  const text = input.trim().replace(/\s+/g, ' ')
  if (!text) throw new Error('Note text must not be empty.')
  if (text.length > MAX_LENGTH) throw new Error(`Note text must be at most ${MAX_LENGTH} characters.`)
  return text
}

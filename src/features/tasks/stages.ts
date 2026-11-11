import type { WorkType } from '@shared/work'

/** The stages of the work policy, in priority order, by the stage number every task carries. */
export const STAGES = [1, 2, 3, 4, 5] as const
export type Stage = (typeof STAGES)[number]

/** Groups rows by their stage, in stage order, dropping empty stages. */
export function byStage<T extends { stage: number }>(rows: readonly T[]): Array<{ stage: number; rows: T[] }> {
  return STAGES.map((stage) => ({ stage, rows: rows.filter((row) => row.stage === stage) })).filter(
    (group) => group.rows.length > 0,
  )
}

/** Tasks a producer fills about the entry as a whole rather than one of its senses. */
export const ENTRY_TASKS: ReadonlySet<WorkType> = new Set([
  'senses',
  'sense_list',
  'forms',
  'pronunciation',
  'phrases',
  'family',
  'morphology',
  'syllables',
  'form_pronunciations',
])

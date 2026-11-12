/** The stages of the work policy, in priority order, by the stage number every task carries. */
export const STAGES = [1, 2, 3, 4] as const

/** Groups rows by their stage, in stage order, dropping empty stages. */
export function byStage<T extends { stage: number }>(rows: readonly T[]): Array<{ stage: number; rows: T[] }> {
  return STAGES.map((stage) => ({ stage, rows: rows.filter((row) => row.stage === stage) })).filter(
    (group) => group.rows.length > 0,
  )
}

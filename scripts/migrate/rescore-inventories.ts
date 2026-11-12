/**
 * The Jev step of scripts/migrate/rescore_inventories.py: replays today's review chain on each
 * exported inventory without asking the LLM again. Jev judges each gloss as a new inventory's review
 * would; a pass it settles records reviewer jev, otherwise the inventory's LLM verdict stands behind
 * Jev's answers (reviewer jev+llm), exactly as the chain records it.
 *
 * Bundle and run (esbuild resolves the tsconfig path aliases):
 *   node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/bin/esbuild scripts/migrate/rescore-inventories.ts \
 *     --bundle --platform=node --format=esm --outfile=<work-dir>/rescore.mjs
 *   MODEL_BASE_URL=… MODEL_API_KEY=… JEV_MODEL=… node <work-dir>/rescore.mjs <work-dir>
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createJevReviewer } from '@server/adapters/reviewers/jev'
import { planReview } from '@server/domain/fact-kinds'
import { chainVerdict, decisionOpinion, decisionSettles, type Opinion, scoreOf } from '@server/domain/review-chain'
import { ReviewerTransportError } from '@server/usecases/ports'
import type { FactPayloads, Review, SenseId } from '@shared/facts'

interface Exported {
  factId: string
  lemma: string
  caseVariants: string[]
  payload: FactPayloads['senses']
  review: Review
}

const CONCURRENCY = 12
const TRANSPORT_RETRIES = 4

const env = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set.`)
  return value
}

const jev = createJevReviewer({ baseUrl: env('MODEL_BASE_URL'), apiKey: env('MODEL_API_KEY'), model: env('JEV_MODEL') })

async function askWithRetry(questions: Record<string, string>, state: Record<string, string | readonly string[]>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await jev.ask(questions, state)
    } catch (error) {
      if (!(error instanceof ReviewerTransportError) || attempt > TRANSPORT_RETRIES) throw error
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
}

async function rescore(item: Exported, at: string): Promise<{ factId: string; previousReviewedAt: string; review: Review }> {
  const subject = {
    lemma: item.lemma,
    senses: item.payload.senses.map(({ id, pos, gloss }) => ({ id: id as SenseId, pos, gloss })),
    caseVariants: item.caseVariants,
  }
  const plan = planReview('senses', item.payload, { subject, target: null, topic: null })
  if (plan.kind !== 'review' || !plan.decision) throw new Error(`Inventory ${item.factId} has no decision request.`)
  const request = plan.decision
  const [gate] = request.gates
  const answers = await askWithRetry(request.questions, request.state)
  const jevOpinion = decisionOpinion(gate.model, gate.passAt, answers)
  const settled = decisionSettles(request, new Map([[gate.model, scoreOf(answers)]]))
  const { reviewer, model, verdict, confidence, reason, detail, context } = item.review
  const llm: Opinion = { reviewer: reviewer as 'llm', model, verdict, confidence, reason, detail }
  const chained = settled ? chainVerdict([jevOpinion], scoreOf(answers)) : chainVerdict([jevOpinion, llm])
  return {
    factId: item.factId,
    previousReviewedAt: item.review.reviewed_at,
    review: { ...chained, detail: { ...chained.detail, rescored: true }, context, reviewed_at: at },
  }
}

async function main(work: string) {
  const items = readFileSync(join(work, 'inventories.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Exported)
  const out = join(work, 'scored.jsonl')
  // Resumable: an inventory already scored is skipped.
  const done = new Set(
    existsSync(out)
      ? readFileSync(out, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => (JSON.parse(line) as { factId: string }).factId)
      : [],
  )
  const todo = items.filter((item) => !done.has(item.factId))
  const at = new Date().toISOString()
  let next = 0
  let scored = done.size
  let settled = 0
  const worker = async () => {
    while (next < todo.length) {
      const item = todo[next++] as Exported
      const result = await rescore(item, at)
      appendFileSync(out, `${JSON.stringify(result)}\n`)
      scored++
      if (result.review.reviewer === 'jev') settled++
      if (scored % 200 === 0) console.log(`${scored}/${items.length} scored, ${settled} settled by jev this run`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`done: ${scored}/${items.length} scored, ${settled} settled by jev this run`)
}

const [work] = process.argv.slice(2)
if (!work) throw new Error('usage: rescore.mjs <work-dir>')
await main(work)

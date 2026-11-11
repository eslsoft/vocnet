import type { FactKind, FactPayloads, Pos, SenseId, TopicId } from '@shared/facts'
import type { Gap } from '@shared/work'
import type { Fact } from './fact'
import {
  closableGaps,
  GENERAL_LIMITS,
  limitsOf,
  planReview,
  type ReviewContext,
  type ReviewRequest,
  type SubjectViews,
  subjectTypeOf,
} from './fact-kinds'
import { JEV_POLICY } from './fact-lifecycle'
import type { TopicView } from './topics'

/** How the reviewers judge one kind of fact that fills an item: the prompts they receive and the write rules. */
export interface FillCriteria {
  kind: FactKind
  /** What the sample claims, such as "relation synonym". */
  claim: string
  /** The questions Jev scores and how its scores decide; null when the LLM judges alone. */
  jev: { questions: string[]; rule: string } | null
  /** The LLM rubric, the exact prompt of its review with the item's values as placeholders. */
  rubric: string
  /** The write rules a submission must meet before it is reviewed. */
  limits: readonly string[]
}

/** The standard every fact that fills an item, and a closure of it, is judged by. */
export interface WorkCriteria {
  fills: FillCriteria[]
  /** The rubric of a gap_closure of the item's gap; null for a gap no closure may close. */
  closure: string | null
  /** The write rules every submission meets. */
  limits: readonly string[]
}

type Sample = { [K in FactKind]: { kind: K; claim: string; payload: FactPayloads[K] } }[FactKind]
const sample = <K extends FactKind>(kind: K, claim: string, payload: FactPayloads[K]) =>
  ({ kind, claim, payload }) as Sample

// The prompts are rendered for placeholders, not for the item's subject: the standard is the same
// for every word, and a rendered value would read as the expected answer.
const WORD = '<word>'
const TARGET = '00000000-0000-4000-8000-000000000000' as SenseId
const entryView: SubjectViews['entry'] = {
  lemma: WORD,
  senses: [],
  inflectionOf: [],
  variantOf: [],
  cefr: [],
  caseVariants: [],
}
const senseView = (pos: Pos): SubjectViews['sense'] => ({
  lemma: WORD,
  pos,
  gloss: '<the gloss of the sense>',
  siblings: [],
})
const targetView = (pos: Pos): SubjectViews['sense'] => ({
  lemma: '<other word>',
  pos,
  gloss: '<the gloss of its sense>',
  siblings: [],
})
const topicView: TopicView = { category: '<category>', topic: '<topic>' }

const relation = (type: FactPayloads['relation']['type'], claim: string) =>
  sample('relation', claim, { type, target_sense_id: TARGET })

/** A sample grammar claim of each part of speech that takes one. */
const GRAMMAR_SAMPLES: Partial<Record<Pos, FactPayloads['grammar']>> = {
  noun: { countability: 'countable' },
  verb: { transitivity: 'transitive' },
  adjective: { position: 'both' },
  adverb: { position: 'mid' },
  determiner: { agreement: ['singular_noun'] },
  pronoun: { agreement: ['singular_verb'] },
}

/**
 * The facts that fill each type of item, as samples whose values are placeholders. A weak fact is
 * filled by a correction of its own kind, judged with its own payload.
 */
function samplesOf(gap: Gap, pos: Pos, weak: Fact | null): Sample[] {
  switch (gap.type) {
    case 'senses':
      return [
        sample('sense', 'sense', { gloss: '<gloss>' }),
        sample('sense_list', 'sense_list', { common: [], extra: [] }),
      ]
    case 'sense_list':
      return [sample('sense_list', 'sense_list', { common: [], extra: [] })]
    case 'forms':
      return [...new Set(gap.missing.map((slot) => slot.type))].map((type) =>
        sample('form', `form ${type}`, { form: '<form>', type }),
      )
    case 'pronunciation':
      return gap.accents.map((accent) => sample('pronunciation', `pronunciation ${accent}`, { ipa: '<ipa>', accent }))
    case 'phrases':
      return [
        sample('entry', 'entry of the phrase', {}),
        sample('sense', 'verb sense of the phrase', { gloss: '<gloss>' }),
      ]
    case 'family':
      return [
        sample('entry', 'entry of the derivative', {}),
        sample('morphology', 'morphology of the derivative', {
          parts: [
            { form: WORD, role: 'base', lemma: WORD },
            { form: '-<suffix>', role: 'suffix' },
          ],
        }),
      ]
    case 'morphology':
      return [sample('morphology', 'morphology', { parts: [{ form: WORD, role: 'base' }] })]
    case 'syllables':
      return [sample('syllables', 'syllables', { syllables: ['<syllable>'] })]
    case 'form_pronunciations':
      return [
        sample('form', 'form with its pronunciation', { form: '<form>', type: 'past', ipa: '<ipa>', accent: 'us' }),
      ]
    case 'category':
      return [relation('hypernym', 'relation hypernym (everyday layer, no domain)')]
    case 'parts':
      return [relation('part_of', 'relation part_of, from the part to this sense')]
    case 'synonyms':
      return [relation('synonym', 'relation synonym'), relation('antonym', 'relation antonym')]
    case 'examples':
      return [sample('example', 'example', { text: '<sentence>', translations: { zh: '<translation>' } })]
    case 'translations':
      return [sample('translation', 'translation zh', { language: 'zh', text: '<translation>' })]
    case 'example_translations':
      return [
        sample('example', 'example with its zh translation', {
          text: '<sentence>',
          translations: { zh: '<translation>' },
        }),
      ]
    case 'topics':
      return [sample('topic', 'topic', { topic_id: '<topic>' as TopicId })]
    case 'grammar': {
      const payload = GRAMMAR_SAMPLES[pos]
      return payload ? [sample('grammar', `grammar (a sample ${pos} claim)`, payload)] : []
    }
    case 'collocations':
      return [sample('collocation', 'collocation', { text: '<collocation>', pattern: 'phrase' })]
    case 'weak_fact':
      return weak ? [{ kind: weak.kind, claim: `correction of the ${weak.kind}`, payload: weak.payload } as Sample] : []
  }
}

function contextFor(kind: FactKind, payload: Sample['payload'], pos: Pos, taxonomy: readonly TopicView[]) {
  const subject = subjectTypeOf(kind, payload as never) === 'entry' ? entryView : senseView(pos)
  return {
    subject,
    target: kind === 'relation' ? targetView(pos) : null,
    topic: kind === 'topic' ? topicView : null,
    attempts: [],
    taxonomy,
    blocked: [],
  } as ReviewContext
}

/** How Jev's scores decide, stated plainly from the request and the Jev policy. */
function jevRule(request: ReviewRequest<'jev'>): string {
  return [
    'Jev scores each question from 0 to 1.',
    request.settlesPass === false
      ? 'A Jev pass still goes to the LLM rubric.'
      : `When every score is ${JEV_POLICY.passAt} or more the fact passes without the LLM.`,
    request.settlesFailBelow === undefined ? '' : `A Jev score below ${request.settlesFailBelow} fails without appeal.`,
    'Otherwise the LLM rubric decides.',
  ]
    .filter((part) => part.length > 0)
    .join(' ')
}

/** The requests of a plan for a placeholder sample: every sample is reviewable, so another plan is a bug. */
function requestsOf(kind: FactKind, plan: ReturnType<typeof planReview>) {
  if (plan.kind === 'unreviewable') throw new Error(`The ${kind} criteria sample is unreviewable: ${plan.reason}`)
  const requests: readonly ReviewRequest[] = plan.requests
  const jev = requests.find((request): request is ReviewRequest<'jev'> => request.reviewer === 'jev')
  const llm = requests.find((request): request is ReviewRequest<'llm'> => request.reviewer === 'llm')
  if (!llm) throw new Error(`The review plan of ${kind} has no LLM request.`)
  return { jev, llm }
}

function fillCriteria({ kind, claim, payload }: Sample, pos: Pos): FillCriteria {
  const { jev, llm } = requestsOf(kind, planReview(kind, payload as never, contextFor(kind, payload, pos, [])))
  return {
    kind,
    claim,
    jev: jev ? { questions: Object.values(jev.questions), rule: jevRule(jev) } : null,
    rubric: llm.prompt.user,
    limits: limitsOf(kind),
  }
}

function closureCriteria(gap: Gap, pos: Pos, taxonomy: readonly TopicView[]): string | null {
  if (!(gap.type in closableGaps)) return null
  const payload = { gap: gap.type as FactPayloads['gap_closure']['gap'], reason: '<your reason>' }
  const shown = closableGaps[payload.gap].taxonomy ? taxonomy : []
  return requestsOf('gap_closure', planReview('gap_closure', payload, contextFor('gap_closure', payload, pos, shown)))
    .llm.prompt.user
}

const cache = new Map<string, WorkCriteria>()

/**
 * The standard the reviewers apply to the facts that fill an item and to a closure of it: the same
 * plans the reviews build, rendered for placeholder values. A sense item is rendered for its part
 * of speech, an entry item for none of the senses. The taxonomy changes only by migration, so the
 * rendering is cached by what it reads, except a weak fact's, which carries its own payload.
 */
export function workCriteria(
  gap: Gap,
  pos: Pos | null,
  weak: Fact | null,
  taxonomy: readonly TopicView[],
): WorkCriteria {
  const asPos = pos ?? 'noun'
  const samples = samplesOf(gap, asPos, weak)
  const key = gap.type === 'weak_fact' ? null : `${asPos}|${JSON.stringify(samples)}`
  const cached = key === null ? undefined : cache.get(key)
  if (cached) return cached
  const criteria = {
    fills: samples.map((one) => fillCriteria(one, asPos)),
    closure: closureCriteria(gap, asPos, taxonomy),
    limits: GENERAL_LIMITS,
  }
  if (key !== null) cache.set(key, criteria)
  return criteria
}

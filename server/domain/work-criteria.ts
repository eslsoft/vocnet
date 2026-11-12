import type { FactKind, FactPayloads, Pos, SenseId, TopicId } from '@shared/facts'
import type { Gap } from '@shared/work'
import {
  type DecisionModel,
  type DecisionRequest,
  GENERAL_LIMITS,
  limitsOf,
  planReview,
  type ReviewContext,
  type SubjectViews,
  subjectTypeOf,
} from './fact-kinds'
import type { TopicView } from './topics'

/** How the reviewers judge one kind of fact that fills an item: the prompts they receive and the write rules. */
export interface FillCriteria {
  kind: FactKind
  /** What the sample claims, such as "relation synonym". */
  claim: string
  /** The questions the decision models score and how their scores settle; null when the LLM judges alone. */
  decision: { models: DecisionModel[]; questions: string[]; rule: string } | null
  /** The LLM rubric, the exact prompt of its review with the item's values as placeholders. */
  rubric: string
  /** The write rules a submission must meet before it is reviewed. */
  limits: readonly string[]
}

/** The standard every fact that fills an item is judged by. */
export interface WorkCriteria {
  fills: FillCriteria[]
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
const entryView: SubjectViews['entry'] = { lemma: WORD, senses: [], caseVariants: [] }
const senseView = (pos: Pos): SubjectViews['sense'] => ({
  lemma: WORD,
  pos,
  gloss: '<the gloss of the sense>',
  siblings: [],
})
const factView = (kind: 'example' | 'collocation', pos: Pos): SubjectViews['fact'] => ({
  kind,
  text: kind === 'example' ? '<sentence>' : '<collocation>',
  sense: senseView(pos),
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

const INVENTORY_SAMPLE: FactPayloads['senses'] = {
  senses: [{ id: TARGET, pos: 'noun', gloss: '<gloss>', rank: 'common' }],
}

/** The facts that fill each type of item, as samples whose values are placeholders. */
function samplesOf(gap: Gap, pos: Pos): Sample[] {
  switch (gap.type) {
    case 'senses':
      return [sample('senses', 'senses (the whole inventory)', INVENTORY_SAMPLE)]
    case 'forms':
      return [...new Set(gap.missing.map((slot) => slot.type))].map((type) =>
        sample('form', `form ${type}`, { form: '<form>', type }),
      )
    case 'pronunciation':
      return gap.accents.map((accent) => sample('pronunciation', `pronunciation ${accent}`, { ipa: '<ipa>', accent }))
    case 'phrases':
      return [sample('phrases', 'phrases (every phrase of the headword)', { phrases: ['<phrase>'] })]
    case 'family':
      return [
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
      return [sample('example', 'example', { text: '<sentence>' })]
    case 'translations':
      return [
        sample('translation', `translation ${gap.language} of a sense`, {
          language: gap.language,
          of: 'sense',
          text: '<translation>',
        }),
        sample('translation', `translation ${gap.language} of an example`, {
          language: gap.language,
          of: 'example',
          text: '<translation>',
        }),
        sample('translation', `translation ${gap.language} of a collocation`, {
          language: gap.language,
          of: 'collocation',
          text: '<translation>',
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
  }
}

function contextFor({ kind, payload }: Sample, pos: Pos): ReviewContext {
  const subjectType = subjectTypeOf(kind, payload as never)
  const subject =
    subjectType === 'entry'
      ? entryView
      : subjectType === 'fact'
        ? factView((payload as FactPayloads['translation']).of === 'collocation' ? 'collocation' : 'example', pos)
        : senseView(pos)
  return {
    subject,
    target: kind === 'relation' ? targetView(pos) : null,
    topic: kind === 'topic' ? topicView : null,
  } as ReviewContext
}

const percent = (score: number) => score.toFixed(2)

/** How the decision models' scores settle, stated plainly from the request. */
function decisionRule({ models, combine, passAt }: DecisionRequest): string {
  const threshold = (model: DecisionModel) => `${model} ${percent(passAt[model] ?? 1)}`
  const settle =
    combine === 'any'
      ? `A pass settles when any of ${models.map(threshold).join(' or ')} is reached.`
      : combine === 'mean'
        ? `A pass settles when the mean score of ${models.join(' and ')} reaches ${percent(passAt[models[0]] ?? 1)}.`
        : `A pass settles when ${models.map(threshold).join(' and ')} ${models.length === 1 ? 'is' : 'are'} reached.`
  return `Each model scores every question from 0 to 1, and its score is the lowest answer. ${settle} Otherwise the LLM rubric decides, and its verdict is final.`
}

function fillCriteria(one: Sample, pos: Pos): FillCriteria {
  const plan = planReview(one.kind, one.payload as never, contextFor(one, pos))
  if (plan.kind === 'unreviewable') throw new Error(`The ${one.kind} criteria sample is unreviewable: ${plan.reason}`)
  return {
    kind: one.kind,
    claim: one.claim,
    decision: plan.decision
      ? {
          models: [...plan.decision.models],
          questions: Object.values(plan.decision.questions),
          rule: decisionRule(plan.decision),
        }
      : null,
    rubric: plan.prompt.user,
    limits: limitsOf(one.kind),
  }
}

const cache = new Map<string, WorkCriteria>()

/**
 * The standard the reviewers apply to the facts that fill an item: the same plans the reviews
 * build, rendered for placeholder values. A sense item is rendered for its part of speech, an
 * entry item for none of the senses. The rendering is cached by what it reads.
 */
export function workCriteria(gap: Gap, pos: Pos | null, _taxonomy: readonly TopicView[]): WorkCriteria {
  const asPos = pos ?? 'noun'
  const samples = samplesOf(gap, asPos)
  const key = `${asPos}|${JSON.stringify(samples)}`
  const cached = cache.get(key)
  if (cached) return cached
  const criteria = { fills: samples.map((one) => fillCriteria(one, asPos)), limits: GENERAL_LIMITS }
  cache.set(key, criteria)
  return criteria
}

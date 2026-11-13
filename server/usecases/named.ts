import type { Fact } from '@server/domain/fact'
import { mentionsOf, type NamedNodes } from '@server/domain/fact-kinds'
import type { Deps } from './deps'

/** The lemmas and texts of the nodes a stored fact names, which nodes never outlive. */
export async function namedNodesOf(deps: Pick<Deps, 'nodes'>, fact: Fact): Promise<NamedNodes> {
  const mentions = mentionsOf(fact.kind, fact.payload)
  const [entries, sentences] = await Promise.all([
    deps.nodes.findEntries(mentions.entries),
    deps.nodes.findSentences(mentions.sentences),
  ])
  return {
    entries: new Map(entries.map((entry) => [entry.id as string, entry.lemma as string])),
    sentences: new Map(sentences.map((sentence) => [sentence.id as string, sentence.text])),
  }
}

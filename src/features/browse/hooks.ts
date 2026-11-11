import type { RelationDomain } from '@shared/facts'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getTopicTree, listMembers, listTopicSenses } from './api'

// The taxonomy is curated by migration, so it changes only with a deploy.
export function useTopicTree() {
  return useQuery({ queryKey: ['public', 'topics'], queryFn: getTopicTree, staleTime: Number.POSITIVE_INFINITY })
}

export function useTopicSenses(topic: string) {
  return useInfiniteQuery({
    queryKey: ['public', 'topic-senses', topic],
    queryFn: ({ pageParam }) => listTopicSenses(topic, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
}

/** The direct kinds of a category: the members at depth 1, page by page while pages hold only those. */
export function useDirectKinds(senseId: string, domain: RelationDomain | undefined) {
  return useInfiniteQuery({
    queryKey: ['public', 'members', senseId, domain ?? null],
    queryFn: ({ pageParam }) => listMembers(senseId, domain, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.next_cursor && page.items.at(-1)?.depth === 1 ? page.next_cursor : undefined),
    select: (data) => data.pages.flatMap((page) => page.items.filter((member) => member.depth === 1)),
  })
}

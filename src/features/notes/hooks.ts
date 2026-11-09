import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createNote, listNotes } from './api'

const notesKey = ['notes'] as const

export function useNotes() {
  return useInfiniteQuery({
    queryKey: notesKey,
    queryFn: ({ pageParam }) => listNotes(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notesKey }),
  })
}

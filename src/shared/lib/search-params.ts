import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

/** URL state for one page: read the params, and set or clear one while keeping the rest. */
export function useSearchParamState(): [URLSearchParams, (name: string, value: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const setParam = (name: string, value: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(name, value)
      else next.delete(name)
      return next
    })
  return [params, setParam]
}

const DEBOUNCE_MS = 300

/**
 * A text filter kept in `?name=`: typing updates the URL once the user pauses, trimmed, and an
 * empty value clears it. Returns the applied value, the input's draft, and the draft's setter.
 */
export function useDebouncedParam(name: string): [string, string, (value: string) => void] {
  const [params, setParam] = useSearchParamState()
  const applied = params.get(name) ?? ''
  const [draft, setDraft] = useState(applied)
  const [seen, setSeen] = useState(applied)
  // Back and forward change the URL under the input; follow them unless the input already says it.
  if (applied !== seen) {
    setSeen(applied)
    if (applied !== draft.trim()) setDraft(applied)
  }
  useEffect(() => {
    const next = draft.trim()
    if (next === applied) return
    const timer = setTimeout(() => setParam(name, next || null), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, applied, name, setParam])
  return [applied, draft, setDraft]
}

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

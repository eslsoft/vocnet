import { type FactId, factIdSchema } from '@shared/facts'
import { useSearchParamState } from '@/shared/lib/search-params'

/** The fact open in the drawer lives in `?fact=`, so any page can deep-link to it. */
export function useFactSelection(): [FactId | null, (id: FactId | null) => void] {
  const [params, setParam] = useSearchParamState()
  return [factIdSchema.safeParse(params.get('fact')).data ?? null, (id) => setParam('fact', id)]
}

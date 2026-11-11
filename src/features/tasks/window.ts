import { type WorkWindow, workWindowSchema } from '@shared/monitor'
import { useSearchParamState } from '@/shared/lib/search-params'

/** The window the queue measures over lives in `?window=`; 24 hours unless it names another. */
export function useTaskWindow(): [WorkWindow, (window: WorkWindow) => void] {
  const [params, setParam] = useSearchParamState()
  const window = workWindowSchema.safeParse(params.get('window')).data ?? '24h'
  return [window, (next) => setParam('window', next === '24h' ? null : next)]
}

import { Link } from 'react-router'
import { useNodeLocation } from './hooks'

/** Links an entry or sense id to the entry inspector, once the owning lemma is known. */
export function EntryLink({ nodeId }: { nodeId: string }) {
  const location = useNodeLocation(nodeId)
  if (location.error) return <span className="text-destructive">{location.error.message}</span>
  if (!location.data) return <span className="text-muted-foreground">{nodeId}</span>
  const { lemma } = location.data.entry
  return (
    <Link className="font-medium underline-offset-4 hover:underline" to={`/entries/${encodeURIComponent(lemma)}`}>
      {lemma}
    </Link>
  )
}

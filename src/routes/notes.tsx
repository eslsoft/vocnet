import { useTranslation } from 'react-i18next'
import { CreateNoteDialog, useNotes } from '@/features/notes'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

export default function NotesPage() {
  const { t } = useTranslation()
  const notes = useNotes()
  const items = notes.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-xl font-semibold">{t('notesTitle')}</h1>
        <CreateNoteDialog />
      </div>

      {notes.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : items.length > 0 ? (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {items.map((note) => (
              <li key={note.id}>
                <Card size="sm">
                  <CardContent>{note.text}</CardContent>
                </Card>
              </li>
            ))}
          </ul>
          {notes.hasNextPage && (
            <Button variant="outline" onClick={() => notes.fetchNextPage()} disabled={notes.isFetchingNextPage}>
              {t('loadMore')}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t('notesEmpty')}</p>
      )}
    </div>
  )
}

import type { WorkItemOverview } from '@shared/monitor'
import { PASS_NOTE_MAX } from '@shared/work'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Textarea } from '@/shared/ui/textarea'
import { useSettleSlot } from './hooks'

type SettledTask = Pick<WorkItemOverview, 'entry' | 'type' | 'subject_id'>

/**
 * A curator records that nothing fills the task's slot, with why: the slot counts as filled and the
 * task closes. Any slot can be settled this way, a required one included.
 */
export function SettleSlotDialog({ task }: { task: SettledTask }) {
  const { t } = useTranslation()
  const settle = useSettleSlot()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const noteId = useId()
  const close = () => {
    settle.reset()
    setNote('')
    setOpen(false)
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('settle.action')}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              settle.mutate(
                { entryId: task.entry.id, slot: { type: task.type, subject_id: task.subject_id, note } },
                { onSuccess: close },
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t('settle.title', { type: t(`taskType.${task.type}`), lemma: task.entry.lemma })}
              </DialogTitle>
              <DialogDescription>{t('settle.description')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1">
              <label htmlFor={noteId} className="text-muted-foreground text-xs">
                {t('settle.note')}
              </label>
              <Textarea
                id={noteId}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
                maxLength={PASS_NOTE_MAX}
              />
            </div>
            <ErrorNotice error={settle.error} />
            <DialogFooter>
              <Button type="submit" disabled={settle.isPending || note.trim() === ''}>
                {t('settle.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

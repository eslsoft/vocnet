import { type ResolveTicketInput, resolveTicketInputSchema, type TicketId } from '@shared/tickets'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Textarea } from '@/shared/ui/textarea'
import { useResolveTicket } from './hooks'

const factIdsOf = (text: string) => text.split(/[\s,]+/).filter((part) => part !== '')

/** A form's input decoded with the wire schema, so a malformed fact id is caught where it was typed. */
function decode(resolution: ResolveTicketInput['resolution'], note: string, factIds: string) {
  const input = resolution === 'resolved' ? { resolution, note, fact_ids: factIdsOf(factIds) } : { resolution, note }
  const parsed = resolveTicketInputSchema.safeParse(input)
  return parsed.success
    ? { input: parsed.data, error: null }
    : { input: null, error: new Error(parsed.error.issues[0]?.message) }
}

/** A curator closes an open ticket: resolved, naming the facts that fixed it, or dismissed, saying why. */
export function ResolveTicketDialog({ ticketId }: { ticketId: TicketId }) {
  const { t } = useTranslation()
  const resolve = useResolveTicket(ticketId)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [factIds, setFactIds] = useState('')
  const [invalid, setInvalid] = useState<Error | null>(null)
  const noteId = useId()
  const factsId = useId()
  const close = () => {
    resolve.reset()
    setNote('')
    setFactIds('')
    setInvalid(null)
    setOpen(false)
  }
  const submit = (resolution: ResolveTicketInput['resolution']) => {
    const { input, error } = decode(resolution, note, factIds)
    setInvalid(error)
    if (input) resolve.mutate(input, { onSuccess: close })
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t('tickets.resolveAction')}</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('tickets.resolveTitle')}</DialogTitle>
              <DialogDescription>{t('tickets.resolveDescription')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1">
              <label htmlFor={noteId} className="text-muted-foreground text-xs">
                {t('tickets.note')}
              </label>
              <Textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={factsId} className="text-muted-foreground text-xs">
                {t('tickets.fixingFacts')}
              </label>
              <Textarea
                id={factsId}
                value={factIds}
                onChange={(event) => setFactIds(event.target.value)}
                className="min-h-14 font-mono text-xs"
              />
            </div>
            <ErrorNotice error={invalid ?? resolve.error} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={resolve.isPending || note.trim() === ''}
                onClick={() => submit('dismissed')}
              >
                {t('tickets.dismiss')}
              </Button>
              <Button
                type="button"
                disabled={resolve.isPending || note.trim() === ''}
                onClick={() => submit('resolved')}
              >
                {t('tickets.resolve')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

import { Dialog } from '@base-ui/react/dialog'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, buttonVariants } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useCreateNote } from './hooks'

export function CreateNoteDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const add = useCreateNote()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    add.reset()
    add.mutate(
      { text },
      {
        onSuccess: () => {
          setText('')
          setOpen(false)
        },
      },
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={buttonVariants()}>{t('createNote')}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40" />
        <Dialog.Viewport className="fixed inset-0 grid place-items-center p-4">
          <Dialog.Popup className="bg-background w-full max-w-md rounded-xl border p-5 shadow-xl">
            <Dialog.Title className="font-heading text-lg font-semibold">{t('createNote')}</Dialog.Title>
            <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
              <Input
                aria-label={t('notePlaceholder')}
                placeholder={t('notePlaceholder')}
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
                maxLength={500}
              />
              {add.error ? (
                <p className="text-destructive text-sm" role="alert">
                  {add.error.message}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Dialog.Close className={buttonVariants({ variant: 'outline' })}>{t('cancel')}</Dialog.Close>
                <Button type="submit" disabled={add.isPending}>
                  {t('addNote')}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

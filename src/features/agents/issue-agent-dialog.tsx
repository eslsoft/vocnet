import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Input } from '@/shared/ui/input'
import { useIssueAgent } from './hooks'

function SecretOnce({ name, secret }: { name: string; secret: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('agents.secretTitle', { name })}</DialogTitle>
        <DialogDescription>{t('agents.secretDescription')}</DialogDescription>
      </DialogHeader>
      <code className="break-all rounded-md bg-muted p-3 text-xs" data-testid="agent-secret">
        {secret}
      </code>
      <DialogFooter>
        <Button
          onClick={async () => {
            await navigator.clipboard.writeText(secret)
            setCopied(true)
          }}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Issues a key in a modal; the secret replaces the form and is never shown again once closed. */
export function IssueAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const issue = useIssueAgent()
  const [name, setName] = useState('')
  const nameId = useId()
  // The dialog has no trigger, so it only ever asks to close.
  const close = () => {
    issue.reset()
    setName('')
    onClose()
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {issue.data ? (
          <SecretOnce name={issue.data.agent.name} secret={issue.data.key} />
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              issue.mutate(name)
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('agents.issueTitle')}</DialogTitle>
              <DialogDescription>{t('agents.issueDescription')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1">
              <label htmlFor={nameId} className="text-muted-foreground text-xs">
                {t('agents.name')}
              </label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={100}
              />
            </div>
            <ErrorNotice error={issue.error} />
            <DialogFooter>
              <Button type="submit" disabled={issue.isPending}>
                {t('agents.issueSubmit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

import type { AgentDto } from '@shared/agents'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { useRevokeAgent } from './hooks'

export function RevokeAgentDialog({ agent, onClose }: { agent: AgentDto | null; onClose: () => void }) {
  const { t } = useTranslation()
  const revoke = useRevokeAgent()
  const close = () => {
    revoke.reset()
    onClose()
  }
  return (
    <Dialog open={agent !== null} onOpenChange={close}>
      <DialogContent>
        {agent ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('agents.revokeTitle', { name: agent.name })}</DialogTitle>
              <DialogDescription>{t('agents.revokeDescription')}</DialogDescription>
            </DialogHeader>
            <ErrorNotice error={revoke.error} />
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(agent.id, { onSuccess: close })}
              >
                {t('agents.revoke')}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

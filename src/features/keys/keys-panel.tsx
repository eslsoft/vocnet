import type { AgentDto } from '@shared/agents'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { useAgents } from './hooks'
import { IssueAgentDialog } from './issue-agent-dialog'
import { usePrincipalName } from './principal-name'
import { RevokeAgentDialog } from './revoke-agent-dialog'

function AgentTable({ agents, onRevoke }: { agents: AgentDto[]; onRevoke: (agent: AgentDto) => void }) {
  const { t, i18n } = useTranslation()
  const nameOf = usePrincipalName()
  const date = (iso: string) => formatDateTime(iso, i18n.language)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('keys.name')}</TableHead>
          <TableHead>{t('keys.state')}</TableHead>
          <TableHead>{t('keys.createdBy')}</TableHead>
          <TableHead>{t('keys.created')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('keys.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <TableRow key={agent.id}>
            <TableCell className="font-medium font-mono">{agent.name}</TableCell>
            <TableCell>
              {agent.revoked_at ? (
                <Badge variant="muted" title={date(agent.revoked_at)}>
                  {t('keys.revoked')}
                </Badge>
              ) : (
                <Badge variant="success">{t('keys.active')}</Badge>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{nameOf(agent.created_by)}</TableCell>
            <TableCell className="text-muted-foreground">{date(agent.created_at)}</TableCell>
            <TableCell className="text-right">
              {agent.revoked_at ? null : (
                <Button variant="ghost" size="sm" onClick={() => onRevoke(agent)}>
                  {t('keys.revoke')}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** The agents allowed to write, with the only write actions the console has: issue and revoke a key. */
export function KeysPanel() {
  const { t } = useTranslation()
  const agents = useAgents()
  const [issuing, setIssuing] = useState(false)
  const [revoking, setRevoking] = useState<AgentDto | null>(null)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{t('keys.hint')}</p>
        <Button onClick={() => setIssuing(true)}>
          <KeyRound aria-hidden />
          {t('keys.issue')}
        </Button>
      </div>
      <ErrorNotice error={agents.error} />
      {agents.data?.items.length === 0 ? <p className="text-muted-foreground text-sm">{t('keys.empty')}</p> : null}
      {agents.data && agents.data.items.length > 0 ? (
        <AgentTable agents={agents.data.items} onRevoke={setRevoking} />
      ) : null}
      <IssueAgentDialog open={issuing} onClose={() => setIssuing(false)} />
      <RevokeAgentDialog agent={revoking} onClose={() => setRevoking(null)} />
    </div>
  )
}

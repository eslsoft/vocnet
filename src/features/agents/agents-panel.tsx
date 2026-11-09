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
import { RevokeAgentDialog } from './revoke-agent-dialog'

export function AgentsPanel() {
  const { t, i18n } = useTranslation()
  const agents = useAgents()
  const [issuing, setIssuing] = useState(false)
  const [revoking, setRevoking] = useState<AgentDto | null>(null)
  const date = (iso: string) => formatDateTime(iso, i18n.language)
  return (
    <div className="flex flex-col gap-4">
      <Button className="self-start" onClick={() => setIssuing(true)}>
        <KeyRound aria-hidden />
        {t('agents.issue')}
      </Button>
      <ErrorNotice error={agents.error} />
      {agents.data?.items.length === 0 ? <p className="text-muted-foreground text-sm">{t('agents.empty')}</p> : null}
      {agents.data && agents.data.items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('agents.name')}</TableHead>
              <TableHead>{t('agents.state')}</TableHead>
              <TableHead>{t('agents.createdBy')}</TableHead>
              <TableHead>{t('agents.created')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.data.items.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell className="font-medium">{agent.name}</TableCell>
                <TableCell>
                  {agent.revoked_at ? (
                    <Badge variant="outline" className="text-muted-foreground" title={date(agent.revoked_at)}>
                      {t('agents.revoked')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                      {t('agents.active')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{agent.created_by}</TableCell>
                <TableCell className="text-muted-foreground">{date(agent.created_at)}</TableCell>
                <TableCell className="text-right">
                  {agent.revoked_at ? null : (
                    <Button variant="ghost" size="sm" onClick={() => setRevoking(agent)}>
                      {t('agents.revoke')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <IssueAgentDialog open={issuing} onClose={() => setIssuing(false)} />
      <RevokeAgentDialog agent={revoking} onClose={() => setRevoking(null)} />
    </div>
  )
}

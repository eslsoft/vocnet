import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { FactDrawer, FactStatusBadge, FactTable, useFactSelection } from '@/features/facts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Input } from '@/shared/ui/input'
import { groupEntry } from './entry-view'
import { useManagedEntry } from './hooks'

function LemmaSearch({ lemma }: { lemma?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [value, setValue] = useState(lemma ?? '')
  const inputId = useId()
  return (
    <form
      className="flex max-w-md items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = value.trim()
        if (trimmed) navigate(`/entries/${encodeURIComponent(trimmed)}`)
      }}
    >
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor={inputId} className="text-muted-foreground text-xs">
          {t('entries.lemma')}
        </label>
        <Input id={inputId} value={value} onChange={(event) => setValue(event.target.value)} />
      </div>
      <Button type="submit">{t('entries.search')}</Button>
    </form>
  )
}

function EntryDetail({ lemma }: { lemma: string }) {
  const { t } = useTranslation()
  const entry = useManagedEntry(lemma)
  const [selected, select] = useFactSelection()
  if (entry.error) return <ErrorNotice error={entry.error} />
  if (!entry.data) return null
  const { entryFacts, senses } = groupEntry(entry.data)
  const entryFact = entryFacts.find((fact) => fact.kind === 'entry')
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="font-heading font-semibold text-2xl">{entry.data.entry.lemma}</h2>
        {entryFact ? <FactStatusBadge status={entryFact.status} /> : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('entries.entryFacts')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FactTable facts={entryFacts} onSelect={select} />
        </CardContent>
      </Card>
      {senses.length === 0 ? <p className="text-muted-foreground text-sm">{t('entries.noSenses')}</p> : null}
      {senses.map(({ sense, gloss, facts, incoming }) => (
        <Card key={sense.id}>
          <CardHeader>
            <CardTitle>
              <span className="mr-2 text-muted-foreground italic">{sense.pos}</span>
              {gloss ?? <span className="text-muted-foreground">{t('entries.noGloss')}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <FactTable facts={facts} onSelect={select} />
            {incoming.length > 0 ? (
              <>
                <h4 className="font-medium text-muted-foreground text-xs">{t('entries.incoming')}</h4>
                <FactTable facts={incoming} onSelect={select} />
              </>
            ) : null}
          </CardContent>
        </Card>
      ))}
      <FactDrawer factId={selected} onSelect={select} />
    </div>
  )
}

/** Search by lemma, then show the entry's senses with every fact in every status. */
export function EntryInspector({ lemma }: { lemma?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <LemmaSearch key={lemma} lemma={lemma} />
      {lemma ? <EntryDetail lemma={lemma} /> : null}
    </div>
  )
}

import { workWindowSchema } from '@shared/monitor'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { cn } from '@/shared/lib/cn'
import { FilterSelect } from '@/shared/ui/filter-select'
import { PageHeader } from '@/shared/ui/page-header'
import { useTaskWindow } from './window'

function ViewLink({ to, end, label }: { to: string; end: boolean; label: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'rounded-md px-3 py-1 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground',
          isActive && 'bg-background text-foreground shadow-sm',
        )
      }
    >
      {label}
    </NavLink>
  )
}

function WindowSelect() {
  const { t } = useTranslation()
  const [window, setWindow] = useTaskWindow()
  return (
    <FilterSelect
      label={t('tasks.window')}
      value={window}
      options={workWindowSchema.options.map((value) => ({ value, label: t(`tasks.windows.${value}`) }))}
      onChange={(value) => setWindow(workWindowSchema.parse(value))}
    />
  )
}

/** The tasks page header: Queue and Activity are two views of one page, each its own URL. */
export function TasksHeader({ view }: { view: 'queue' | 'activity' }) {
  const { t } = useTranslation()
  return (
    <PageHeader
      title={t('tasks.title')}
      subtitle={t('tasks.subtitle')}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label={t('tasks.views')} className="inline-flex items-center rounded-lg bg-muted p-[3px]">
            <ViewLink to="/console/tasks" end label={t('tasks.queue')} />
            <ViewLink to="/console/tasks/activity" end label={t('tasks.activity')} />
          </nav>
          {view === 'queue' ? <WindowSelect /> : null}
        </div>
      }
    />
  )
}

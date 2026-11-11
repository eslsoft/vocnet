import { ListTodo } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatRelative } from '@/shared/lib/format'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { useTasks } from './hooks'
import { TaskStatusBadge, taskPath } from './task-badges'

/** The open tasks about one subject, such as a flagged fact, each linking to its detail. */
export function SubjectTasks({ subjectId }: { subjectId: string }) {
  const { t, i18n } = useTranslation()
  const tasks = useTasks({ subject_id: subjectId })
  if (tasks.error) return <ErrorNotice error={tasks.error} />
  if (!tasks.data || tasks.data.items.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {tasks.data.items.map((task) => (
        <li key={task.id}>
          <Link
            to={taskPath(task.id)}
            className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm hover:border-primary/50"
          >
            <ListTodo aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{t('taskDetail.title', { type: t(`taskType.${task.type}`) })}</span>
              <span className="text-muted-foreground text-xs">
                {t('taskDetail.createdTries', {
                  created: formatRelative(task.created_at, i18n.language),
                  count: task.attempts_without_progress,
                })}
              </span>
            </span>
            <TaskStatusBadge status={task.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

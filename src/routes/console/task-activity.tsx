import { TasksActivity, TasksHeader } from '@/features/tasks'

export default function TaskActivityPage() {
  return (
    <div className="flex flex-col gap-6">
      <TasksHeader view="activity" />
      <TasksActivity />
    </div>
  )
}

import { TasksHeader, TasksQueue } from '@/features/tasks'

export default function TasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <TasksHeader view="queue" />
      <TasksQueue />
    </div>
  )
}

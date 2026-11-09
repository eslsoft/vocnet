export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-heading font-semibold text-xl">{title}</h1>
      <p className="text-muted-foreground text-sm">{subtitle}</p>
    </div>
  )
}

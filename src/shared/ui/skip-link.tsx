/** The first focus stop of a page: jumps past the navigation to #main. */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href="#main"
      className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      {label}
    </a>
  )
}

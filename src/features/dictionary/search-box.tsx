import { Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { cn } from '@/shared/lib/cn'
import { CefrBadge } from './badges'
import { wordPath } from './entry-format'
import { useSearch } from './hooks'

const DEBOUNCE_MS = 150
const HITS = 8

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

/**
 * Instant search over GET /v1/search as an ARIA combobox: arrows move through the hits, Enter opens
 * the highlighted one (or looks the text up as a headword), Escape closes, and / focuses it anywhere.
 */
export function SearchBox({ size = 'default', className }: { size?: 'default' | 'lg'; className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const query = useDebounced(text)
  const search = useSearch(query, HITS)
  const hits = text.trim() && search.data ? search.data.items : []
  const expanded = open && text.trim().length > 0

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key !== '/' || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return
      }
      if (size !== 'lg' && document.querySelector('[data-search-primary]')) return
      event.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [size])

  const go = (lemma: string) => {
    setOpen(false)
    setText('')
    setActive(-1)
    input.current?.blur()
    navigate(wordPath(lemma))
  }

  return (
    <search className={cn('relative block', className)} data-search-primary={size === 'lg' ? '' : undefined}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const lemma = active >= 0 ? hits[active]?.lemma : text.trim()
          if (lemma) go(lemma)
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          {t('search.label')}
        </label>
        <Search
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground',
            size === 'lg' ? 'size-5' : 'size-4',
          )}
        />
        <input
          ref={input}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={t('search.placeholder')}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && hits.length > 0) {
              event.preventDefault()
              setOpen(true)
              setActive((index) => (index + 1) % hits.length)
            } else if (event.key === 'ArrowUp' && hits.length > 0) {
              event.preventDefault()
              setActive((index) => (index <= 0 ? hits.length - 1 : index - 1))
            } else if (event.key === 'Escape') {
              if (expanded) event.preventDefault()
              setOpen(false)
              setActive(-1)
            }
          }}
          className={cn(
            'w-full min-w-0 rounded-lg border border-input bg-background text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:hidden',
            size === 'lg' ? 'h-14 pr-14 pl-11 text-lg' : 'h-9 pr-9 pl-9 text-sm',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-muted-foreground text-xs sm:block',
            text && 'sm:hidden',
          )}
        >
          /
        </span>
      </form>
      <div
        id={listId}
        role="listbox"
        aria-label={t('search.results')}
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[60vh] overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        {hits.map((hit, index) => (
          <div
            key={hit.lemma}
            id={`${listId}-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => go(hit.lemma)}
            onMouseEnter={() => setActive(index)}
            onKeyDown={() => undefined}
            className={cn(
              'flex cursor-pointer items-baseline gap-2 rounded-md px-3 py-2',
              index === active && 'bg-accent text-accent-foreground',
            )}
          >
            <span className="shrink-0 font-medium font-serif text-base">{hit.lemma}</span>
            {hit.cefr ? <CefrBadge level={hit.cefr} className="shrink-0 self-center" /> : null}
            <span className="truncate text-muted-foreground text-sm">
              {hit.translation ? <span lang="zh-CN">{hit.translation} · </span> : null}
              {hit.gloss}
            </span>
          </div>
        ))}
        {search.data && hits.length === 0 && !search.isFetching ? (
          <p className="px-3 py-2 text-muted-foreground text-sm">{t('search.empty', { q: text.trim() })}</p>
        ) : null}
        {search.error ? (
          <p role="alert" className="px-3 py-2 text-destructive text-sm">
            {search.error.message}
          </p>
        ) : null}
        <p className="border-t px-3 pt-2 pb-1 text-muted-foreground text-xs">{t('search.hint')}</p>
      </div>
    </search>
  )
}

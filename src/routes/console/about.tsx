import { BookOpenText, Braces, FileJson } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { PageHeader } from '@/shared/ui/page-header'

export default function AboutPage() {
  const { t } = useTranslation()
  const links = [
    { icon: BookOpenText, label: t('about.site'), to: '/' },
    { icon: Braces, label: t('about.guide'), to: '/developers' },
  ]
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('aboutTitle')} subtitle={t('aboutBody')} />
      <ul className="grid gap-3 sm:grid-cols-3">
        {links.map(({ icon: Icon, label, to }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm shadow-xs hover:border-primary/50"
            >
              <Icon aria-hidden="true" className="size-5 text-primary" />
              {label}
            </Link>
          </li>
        ))}
        <li>
          <a
            href="/manage/openapi.json"
            className="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm shadow-xs hover:border-primary/50"
          >
            <FileJson aria-hidden="true" className="size-5 text-primary" />
            {t('site.apiReference')}
          </a>
        </li>
      </ul>
    </div>
  )
}

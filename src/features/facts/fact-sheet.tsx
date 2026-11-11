import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { FactDetail } from './fact-detail'
import { useFactSelection } from './selection'

/** The fact in `?fact=` over any page, so a fact opens where the admin found it. */
export function FactSheet() {
  const { t } = useTranslation()
  const [selected, select] = useFactSelection()
  return (
    <Sheet open={selected !== null} onOpenChange={(open) => !open && select(null)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pb-0">
          <SheetTitle className="font-normal text-muted-foreground text-xs">{t('factDetail.title')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">{selected ? <FactDetail factId={selected} onSelect={select} /> : null}</div>
      </SheetContent>
    </Sheet>
  )
}

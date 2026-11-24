import { useEffect } from 'react'
import { t } from '../i18n'

/** The tab's title: the page's own, followed by the name of the product. */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? t('app.pageTitle', { title }) : t('app.title')
  }, [title])
}

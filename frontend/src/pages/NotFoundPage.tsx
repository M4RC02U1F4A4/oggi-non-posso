import { Link } from 'react-router'
import { Header } from '../components/Header'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { t } from '../i18n'
import '../styles/NotFoundPage.css'

/** An address that leads nowhere: an event that is not there, or any other path. */
export function NotFoundPage({ kind = 'page' }: { kind?: 'event' | 'page' }) {
  const title = t(`notFound.${kind}.title`)
  useDocumentTitle(title)
  return (
    <div className="page">
      <main className="wrap notfound">
        <Header title={title} />
        <p>{t(`notFound.${kind}.text`)}</p>
        <Link className="btn" to="/">
          {t('notFound.cta')}
        </Link>
      </main>
    </div>
  )
}

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { t } from '../i18n'
import '../styles/Band.css'

interface BandProps {
  /** The big line. Left out while the page has nothing to say yet. */
  title?: string
  /** A small line above the title: the event's name when the title is something else. */
  eyebrow?: string
  /** The state in bold, beside the title on the wide layout. */
  status?: string
  /** Text beside the title, wide layout only. */
  wide?: ReactNode
  /** Text under the title, narrow layout only. */
  narrow?: ReactNode
}

/** The yellow band at the top of every page. */
export function Band({ title, eyebrow, status, wide, narrow }: BandProps) {
  return (
    <header className="band">
      <div className="band__inner wrap">
        <div className="band__main">
          <Link to="/" className="band__logo" aria-label={t('app.home')}>
            {t('app.name')}
          </Link>
          {eyebrow && <p className="band__eyebrow">{eyebrow}</p>}
          {title !== undefined ? <h1 className="band__title">{title}</h1> : <div className="band__title" />}
          {narrow && <p className="band__text only-narrow">{narrow}</p>}
        </div>
        {(status || wide) && (
          <div className="band__side only-wide">
            {status && <strong className="band__status">{status}</strong>}
            {wide}
          </div>
        )}
      </div>
    </header>
  )
}

import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router'
import { t } from '../i18n'
import '../styles/Header.css'

interface HeaderProps {
  /** The big line. Left out while the page has nothing to say yet. */
  title?: ReactNode
  /** A muted line above the title: the event and who organises it. */
  eyebrow?: ReactNode
  /** A muted line under the title. */
  text?: ReactNode
  /** Given when the page moves the focus to its title, after a change of view. */
  titleRef?: Ref<HTMLHeadingElement>
  /** Anything else under the title, such as the state of the voting. */
  children?: ReactNode
}

/** The top of every page: the name of the app, then what the page is about. */
export function Header({ title, eyebrow, text, titleRef, children }: HeaderProps) {
  return (
    <header className="head">
      <Link to="/" className="head__brand" aria-label={t('app.home')}>
        {t('app.title')}
      </Link>
      {eyebrow && <p className="head__eyebrow">{eyebrow}</p>}
      {title !== undefined && (
        <h1 className="head__title" ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
          {typeof title === 'string' ? <bdi>{title}</bdi> : title}
        </h1>
      )}
      {text && <p className="head__text">{text}</p>}
      {children}
    </header>
  )
}

/** The word "not" of "when can you not make it", set apart in red. */
export function NotWord() {
  return <em className="not-word">{t('mark.not')}</em>
}

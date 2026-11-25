import { t } from '../i18n'
import { shareUrl } from '../lib/credentials'
import { CopyButton } from './CopyButton'
import '../styles/ShareBox.css'

/** The link to pass on, for whoever is still missing. */
export function ShareBox({ eventId }: { eventId: string }) {
  return (
    <div className="sharebox">
      <p className="sharebox__title">{t('share.prompt')}</p>
      <div className="linkbox">
        <span className="linkbox__url">{shareUrl(window.location.host, eventId)}</span>
        <CopyButton text={shareUrl(window.location.origin, eventId)} label={t('share.copy')} />
      </div>
    </div>
  )
}

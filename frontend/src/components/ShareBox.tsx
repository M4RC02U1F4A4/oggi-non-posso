import { t } from '../i18n'
import { shareUrl } from '../lib/credentials'
import { CopyButton } from './CopyButton'
import '../styles/ShareBox.css'

/** The link to pass on, for whoever is still missing. */
export function ShareBox({ eventId }: { eventId: string }) {
  return (
    <div className="sharebox">
      <p>{t('share.prompt')}</p>
      <p className="sharebox__url">{shareUrl(window.location.host, eventId)}</p>
      <CopyButton className="link-btn sharebox__copy" text={shareUrl(window.location.origin, eventId)} label={t('share.copy')} />
    </div>
  )
}

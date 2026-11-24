import { useState } from 'react'
import { errorCode, type ErrorCode, type EventData } from '../api/types'
import { t } from '../i18n'
import * as credentials from '../lib/credentials'
import { CopyButton } from './CopyButton'
import '../styles/OrganiserPanel.css'

interface OrganiserPanelProps {
  event: EventData
  onClose: () => Promise<void>
  onReopen: () => Promise<void>
}

/**
 * What only the organiser can do: close the voting (asking first), reopen
 * it, and copy the two links. Shown only when the page was read with the
 * event's organiser key.
 */
export function OrganiserPanel({ event, onClose, onReopen }: OrganiserPanelProps) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const open = event.status === 'open'
  const key = credentials.load(event.id).organiser

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <section className="org" aria-label={t('organiser.label')}>
      {!open ? (
        <>
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run(onReopen)}>
            {t('organiser.reopen')}
          </button>
          <p className="org__help">{t('organiser.reopenHelp')}</p>
        </>
      ) : confirming ? (
        <div className="org__confirm" role="group" aria-label={t('organiser.closeConfirm')}>
          <p>{t('organiser.closeConfirm')}</p>
          <div className="org__choices">
            <button type="button" className="btn" disabled={busy} autoFocus onClick={() => void run(onClose)}>
              {t('organiser.closeYes')}
            </button>
            <button type="button" className="btn btn--outline" disabled={busy} onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="btn btn--block" onClick={() => setConfirming(true)}>
            {t('organiser.close')}
          </button>
          <p className="org__help">{t('organiser.closeHelp')}</p>
        </>
      )}

      {error !== null && (
        <p className="alert org__error" role="alert">
          {t(`error.${error}`)}
        </p>
      )}

      <div className="org__link">
        <span>
          {t('organiser.shareLink')}
          <b>{credentials.shareUrl(window.location.host, event.id)}</b>
        </span>
        <CopyButton
          className="link-btn"
          text={credentials.shareUrl(window.location.origin, event.id)}
          label={t('organiser.copy')}
          ariaLabel={t('organiser.copyShare')}
        />
      </div>
      {key !== undefined && (
        <div className="org__link">
          <span>
            {t('organiser.ownLink')}
            <b>{t('organiser.ownLinkHint')}</b>
          </span>
          <CopyButton
            className="link-btn"
            text={credentials.organiserUrl(window.location.origin, event.id, key)}
            label={t('organiser.copy')}
            ariaLabel={t('organiser.copyOwn')}
          />
        </div>
      )}
    </section>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import { errorCode, type ErrorCode, type EventData } from '../api/types'
import { t } from '../i18n'
import * as credentials from '../lib/credentials'
import { CopyButton } from './CopyButton'
import '../styles/OrganiserPanel.css'

/** The organiser link with its middle left out: enough to recognise it, not to use it. */
export function maskedOrganiserLink(host: string, eventId: string, key: string): string {
  return t('created.own.masked', {
    start: credentials.shareUrl(host, eventId.slice(0, 8)),
    end: key.slice(-4),
  })
}

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
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  // Set when the question goes away and the button that asked it comes back.
  const refocus = useRef(false)

  useEffect(() => {
    if (confirming || !refocus.current) return
    refocus.current = false
    closeRef.current?.focus()
  }, [confirming])

  const cancel = () => {
    refocus.current = true
    setConfirming(false)
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorCode(err))
      // Still open: back to where the person was. A success changes the
      // whole page, which takes the focus to its title.
      refocus.current = true
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <section className="org" aria-labelledby={titleId}>
      <h2 className="box__title" id={titleId}>
        {t('organiser.label')}
      </h2>

      <p className="org__label">{t('organiser.shareLink')}</p>
      <div className="linkbox">
        <span className="linkbox__url">{credentials.shareUrl(window.location.host, event.id)}</span>
        <CopyButton
          text={credentials.shareUrl(window.location.origin, event.id)}
          label={t('organiser.copy')}
          ariaLabel={t('organiser.copyShare')}
        />
      </div>
      {key !== undefined && (
        <>
          <p className="org__label">{t('organiser.ownLink')}</p>
          <div className="linkbox">
            <span className="linkbox__url">{maskedOrganiserLink(window.location.host, event.id, key)}</span>
            <CopyButton
              text={credentials.organiserUrl(window.location.origin, event.id, key)}
              label={t('organiser.copy')}
              ariaLabel={t('organiser.copyOwn')}
            />
          </div>
        </>
      )}

      <div className="org__action">
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
              <button type="button" className="btn btn--outline" disabled={busy} onClick={cancel}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button ref={closeRef} type="button" className="btn btn--block" onClick={() => setConfirming(true)}>
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
      </div>
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { errorCode, type ErrorCode, type EventData, type Participant } from '../api/types'
import type { SaveState } from '../hooks/useEvent'
import { t } from '../i18n'
import { countMarked } from '../lib/grid'
import '../styles/PeoplePanel.css'

interface PeoplePanelProps {
  event: EventData
  /** Participant ids that changed their marks a moment ago. */
  marking: Set<string>
  /** Whether the caller's own marks reached the server. */
  saveState: SaveState
  /** Given to the organiser only: removes a participant, after asking. */
  onRemove?: (participantId: string) => Promise<void>
}

function role(participant: Participant, me: string | null): string | null {
  const mine = participant.id === me
  if (mine && participant.organiser) return t('people.youOrganiser')
  if (mine) return t('people.you')
  return participant.organiser ? t('people.organiser') : null
}

/** Who is in, how many slots each one marked, and who is marking right now. */
export function PeoplePanel({ event, marking, saveState, onRemove }: PeoplePanelProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  // The "Togli" buttons by participant id, to go back to the one that asked.
  const removeButtons = useRef(new Map<string, HTMLButtonElement>())
  // Where the focus goes once the question is gone: the button that asked
  // it, or the list when that person is no longer in it.
  const refocus = useRef<string | 'list' | null>(null)

  useEffect(() => {
    const target = refocus.current
    if (confirming !== null || target === null) return
    refocus.current = null
    const button = target === 'list' ? undefined : removeButtons.current.get(target)
    if (button) button.focus()
    else titleRef.current?.focus()
  }, [confirming])

  const cancel = (participantId: string) => {
    refocus.current = participantId
    setConfirming(null)
  }

  const remove = async (participantId: string) => {
    if (!onRemove) return
    setBusy(true)
    setError(null)
    try {
      await onRemove(participantId)
      refocus.current = 'list'
    } catch (err) {
      setError(errorCode(err))
      refocus.current = participantId
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <section className="people">
      <h2 className="people__title" ref={titleRef} tabIndex={-1}>{t('people.title', { count: event.participants.length })}</h2>
      <ul className="people__list">
        {event.participants.map((participant) => {
          const mine = participant.id === event.me
          const count = countMarked(event, participant.id)
          const tag = role(participant, event.me)
          // The organiser's own participant can not be removed.
          const removable = onRemove !== undefined && !participant.organiser
          return (
            <li className="people__row" key={participant.id}>
              <span className="people__who">
                {participant.name}
                {tag && <small>{tag}</small>}
              </span>
              <span className="people__end">
                {!mine && marking.has(participant.id) ? (
                  <span className="tag-now">{t('people.marking')}</span>
                ) : (
                  <span className="people__state">
                    {!mine
                      ? t('people.slots', { count })
                      : saveState === 'saving'
                        ? t('people.slotsSaving')
                        : saveState === 'failed'
                          ? t('people.slotsFailed')
                          : t('people.slotsSaved', { count })}
                  </span>
                )}
                {removable && confirming !== participant.id && (
                  <button
                    ref={(button) => {
                      if (button) removeButtons.current.set(participant.id, button)
                      else removeButtons.current.delete(participant.id)
                    }}
                    type="button"
                    className="link-btn people__remove"
                    aria-label={t('people.removeLabel', { name: participant.name })}
                    onClick={() => {
                      setError(null)
                      setConfirming(participant.id)
                    }}
                  >
                    {t('people.remove')}
                  </button>
                )}
              </span>
              {removable && confirming === participant.id && (
                <div className="people__confirm" role="group" aria-label={t('people.removeLabel', { name: participant.name })}>
                  <p>{t('people.removeConfirm', { name: participant.name })}</p>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    autoFocus
                    onClick={() => void remove(participant.id)}
                  >
                    {t('people.removeYes')}
                  </button>
                  <button type="button" className="link-btn" disabled={busy} onClick={() => cancel(participant.id)}>
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error !== null && (
        <p className="alert people__error" role="alert">
          {t(`error.${error}`)}
        </p>
      )}
    </section>
  )
}

import { useState } from 'react'
import { useParams } from 'react-router'
import type { EventData } from '../api/types'
import { Band } from '../components/Band'
import { BottomBar } from '../components/BottomBar'
import { JoinForm } from '../components/JoinForm'
import { PeoplePanel } from '../components/PeoplePanel'
import { ShareBox } from '../components/ShareBox'
import { VoteTable } from '../components/VoteTable'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useEvent, type UseEvent } from '../hooks/useEvent'
import { joinList, t } from '../i18n'
import { captureOrganiserKey } from '../lib/credentials'
import { countMarked, findParticipant, organiserOf } from '../lib/grid'
import { NotFoundPage } from './NotFoundPage'
import '../styles/EventPage.css'

export function EventPage() {
  const { id = '' } = useParams()
  // A new id is a new event: start from nothing.
  return <EventView key={id} id={id} />
}

function EventView({ id }: { id: string }) {
  // The organiser link carries its key in the fragment. Take it before the
  // first request, so that request already goes out as the organiser.
  useState(() => captureOrganiserKey(id, window.location, window.history))
  const live = useEvent(id)
  useDocumentTitle(live.event?.title)

  if (live.state === 'not_found') return <NotFoundPage kind="event" />

  if (live.state === 'error') {
    return (
      <div className="page">
        <Band title={t('event.loadFailed')} />
        <main className="wrap event-message">
          <p role="alert">{t(`error.${live.loadError ?? 'internal'}`)}</p>
          <button type="button" className="btn" onClick={live.refresh}>
            {t('common.retry')}
          </button>
        </main>
      </div>
    )
  }

  if (!live.event) {
    return (
      <div className="page">
        <Band />
        <p className="visually-hidden" role="status">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  return live.event.status === 'open' ? (
    <OpenEvent event={live.event} live={live} />
  ) : (
    <ClosedEvent event={live.event} />
  )
}

function OpenEvent({ event, live }: { event: EventData; live: UseEvent }) {
  const me = findParticipant(event, event.me)
  const organiser = organiserOf(event)
  const count = event.participants.length
  const marked = me ? countMarked(event, me.id) : 0
  const others = event.participants.filter((p) => p.id !== event.me && live.marking.has(p.id))

  const visitorText = (
    <>
      {organiser && t('event.tagline.visitor', { name: organiser.name })} {t('people.already', { count })}
    </>
  )

  return (
    <div className={me ? 'page page--bar' : 'page'}>
      <Band
        title={event.title}
        status={t('event.status.open')}
        wide={me ? t(event.can_manage ? 'event.tagline.organiser' : 'event.tagline.participant') : visitorText}
        narrow={
          me ? (
            <>
              {t('event.tagline.short')}{' '}
              {others.length === 0 ? (
                t('people.countAlone', { count })
              ) : (
                <>
                  {t('people.countAnd', { count })}{' '}
                  <span className="tag-now">
                    {t('people.markingNames', { count: others.length, names: joinList(others.map((p) => p.name)) })}
                  </span>
                </>
              )}
            </>
          ) : (
            visitorText
          )
        }
      />

      <main className="wrap event">
        {!me && (
          <div className="event__join">
            {live.dropped && (
              <p className="alert event__removed" role="status">
                {t('event.removed')}
              </p>
            )}
            <JoinForm onJoin={live.join} />
          </div>
        )}

        <div className="event__table">
          <VoteTable event={event} mode={me ? 'mark' : 'read'} onToggle={live.toggle} />

          {live.saveError !== null && (
            <p className="alert event__alert" role="alert">
              {t('event.saveFailed', { reason: t(`error.${live.saveError}`) })}
            </p>
          )}

          <ul className="legend only-wide">
            {me && (
              <li>
                <i className="legend__swatch legend__swatch--mine" />
                {t('legend.mine')}
              </li>
            )}
            <li>
              <i className="legend__swatch legend__swatch--others" />
              <span className="only-light">{t(me ? 'legend.others.light' : 'legend.othersRead.light')}</span>
              <span className="only-dark">{t(me ? 'legend.others.dark' : 'legend.othersRead.dark')}</span>
            </li>
            <li>
              <i className="legend__swatch" />
              {t('legend.free')}
            </li>
          </ul>

          <p className="event__note only-narrow">
            {me ? (
              <>
                <span className="only-light">{t('note.mark.light')}</span>
                <span className="only-dark">{t('note.mark.dark')}</span>
              </>
            ) : (
              t('note.visitor')
            )}
          </p>
        </div>

        <aside className="event__side">
          <PeoplePanel event={event} marking={live.marking} saveState={live.saveState} />
          <div className="event__box">
            <ShareBox eventId={event.id} />
          </div>
        </aside>
      </main>

      {me && (
        <BottomBar>
          <span>{t('bar.marked', { count: marked })}</span>
          <span className="bar__accent">
            {t(live.saveState === 'saving' ? 'bar.saving' : live.saveState === 'failed' ? 'bar.failed' : 'bar.saved')}
          </span>
        </BottomBar>
      )}
    </div>
  )
}

// The closed event gets its own view with the alternatives; until then,
// the table to look at.
function ClosedEvent({ event }: { event: EventData }) {
  return (
    <div className="page">
      <Band title={event.title} status={t('result.status')} />
      <main className="wrap event">
        <div className="event__table">
          <VoteTable event={event} mode="read" />
        </div>
      </main>
    </div>
  )
}

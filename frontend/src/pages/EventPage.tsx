import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import type { EventData } from '../api/types'
import { Band } from '../components/Band'
import { BottomBar } from '../components/BottomBar'
import { JoinForm } from '../components/JoinForm'
import { OrganiserPanel } from '../components/OrganiserPanel'
import { PeoplePanel } from '../components/PeoplePanel'
import { CALENDAR_ID, ResultView } from '../components/ResultView'
import { ShareBox } from '../components/ShareBox'
import { VoteTable } from '../components/VoteTable'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useEvent, type UseEvent } from '../hooks/useEvent'
import { joinList, t } from '../i18n'
import { readOrganiserFragment, stripOrganiserFragment } from '../lib/credentials'
import { countMarked, findParticipant, organiserOf } from '../lib/grid'
import { summarise } from '../lib/result'
import { NotFoundPage } from './NotFoundPage'
import '../styles/EventPage.css'

export function EventPage() {
  const { id = '' } = useParams()
  // A new id is a new event: start from nothing.
  return <EventView key={id} id={id} />
}

function EventView({ id }: { id: string }) {
  // The organiser link carries its key in the fragment. The key goes to the
  // hook as a candidate, to be checked with the server before it is stored;
  // the fragment leaves the address bar at once, whatever it holds.
  const [fragment] = useState(() => readOrganiserFragment(window.location.hash))
  useEffect(() => {
    stripOrganiserFragment(window.location, window.history)
  }, [])
  const live = useEvent(id, fragment.key)
  useDocumentTitle(live.event?.title)
  const badOrganiserLink = live.organiserLinkRejected || (fragment.present && fragment.key === null)

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

  const notice = badOrganiserLink ? (
    <p className="wrap event-notice" role="status">
      <span className="alert">{t('event.organiserLinkInvalid')}</span>
    </p>
  ) : null

  return live.event.status === 'open' ? (
    <OpenEvent event={live.event} live={live} notice={notice} />
  ) : (
    <ClosedEvent event={live.event} live={live} notice={notice} />
  )
}

function OpenEvent({ event, live, notice }: { event: EventData; live: UseEvent; notice: ReactNode }) {
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

      {notice}
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
          <PeoplePanel
            event={event}
            marking={live.marking}
            saveState={live.saveState}
            onRemove={event.can_manage ? live.remove : undefined}
          />
          <div className="event__box">
            {event.can_manage ? (
              <OrganiserPanel event={event} onClose={live.close} onReopen={live.reopen} />
            ) : (
              <ShareBox eventId={event.id} />
            )}
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

/** Above this many people the band counts them without naming them. */
const MAX_NAMES_IN_BAND = 8

function ClosedEvent({ event, live, notice }: { event: EventData; live: UseEvent; notice: ReactNode }) {
  const { headline } = summarise(event)
  const organiser = organiserOf(event)
  const count = event.participants.length
  const names = event.participants.map((p) => p.name).join(t('list.separator'))

  const showCalendar = () => {
    const calendar = document.getElementById(CALENDAR_ID)
    calendar?.scrollIntoView({ block: 'start' })
    calendar?.focus({ preventScroll: true })
  }

  return (
    <div className="page page--bar">
      <Band
        eyebrow={event.title}
        title={headline}
        status={t('result.status')}
        wide={
          <>
            {organiser && t('result.closedBy', { name: organiser.name })}{' '}
            {count > MAX_NAMES_IN_BAND ? t('result.peopleMany', { count }) : t('result.people', { count, names })}
          </>
        }
      />
      {notice}
      <ResultView event={event}>
        {event.can_manage && (
          <div className="event__box">
            <OrganiserPanel event={event} onClose={live.close} onReopen={live.reopen} />
          </div>
        )}
      </ResultView>
      <BottomBar>
        <button type="button" onClick={showCalendar}>
          {t('bar.calendar')}
        </button>
        {organiser && <span className="bar__accent">{t('bar.closedBy', { name: organiser.name })}</span>}
      </BottomBar>
    </div>
  )
}

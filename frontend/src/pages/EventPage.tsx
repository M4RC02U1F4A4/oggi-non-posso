import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useMatch, useNavigate, useParams } from 'react-router'
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
import { countMarked, findParticipant, organiserOf } from '../lib/grid'
import { summarise } from '../lib/result'
import { isUuid } from '../lib/uuid'
import { NotFoundPage } from './NotFoundPage'
import '../styles/EventPage.css'

/** What an address said about organising, read once when the page opens. */
interface OrganiserLink {
  /** True when the address was an organiser link, `/e/<id>/o/<key>`. */
  present: boolean
  /** Its key, when it has the shape of one. Not yet known to be valid. */
  key: string | null
}

/**
 * The page of an event, at `/e/<id>` and at the organiser link
 * `/e/<id>/o/<key>` (whatever follows the key too). The key of an organiser
 * link is only a candidate (anyone can write such an address): it is
 * checked with the server before it is stored. The address is replaced with `/e/<id>` at once, whatever the key
 * turns out to be, so that it stays neither in the address bar nor in the
 * history, and copying the address never hands out the organiser's rights.
 */
export function EventPage() {
  const { id = '' } = useParams()
  const organiserMatch = useMatch('/e/:id/o/:key/*')
  const navigate = useNavigate()
  const linkKey = organiserMatch?.params.key

  useEffect(() => {
    if (linkKey !== undefined) void navigate(`/e/${encodeURIComponent(id)}`, { replace: true })
  }, [linkKey, id, navigate])

  // Not the shape of an event id: there is no such event, and nothing to ask.
  if (!isUuid(id)) return <NotFoundPage kind="event" />

  const link: OrganiserLink = { present: linkKey !== undefined, key: isUuid(linkKey) ? linkKey : null }
  // A new id is a new event: start from nothing.
  return <EventView key={id} id={id} link={link} />
}

function EventView({ id, link }: { id: string; link: OrganiserLink }) {
  // Kept from the first render: by the next one the address has lost the key.
  const [opened] = useState(link)
  const live = useEvent(id, opened.key)
  useDocumentTitle(live.event?.title)
  const badOrganiserLink = live.organiserLinkRejected || (opened.present && opened.key === null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  // The voting closing or opening again, or a name just given, changes the
  // whole page under the person: the focus goes to its new title instead
  // of being lost with the control that had it.
  const status = live.event?.status
  const joined = live.event ? live.event.me !== null : undefined
  const seen = useRef<{ status: string; joined: boolean } | null>(null)
  useEffect(() => {
    if (status === undefined || joined === undefined) return
    const before = seen.current
    seen.current = { status, joined }
    if (before !== null && (before.status !== status || (!before.joined && joined))) titleRef.current?.focus()
  }, [status, joined])

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
    <OpenEvent event={live.event} live={live} notice={notice} titleRef={titleRef} />
  ) : (
    <ClosedEvent event={live.event} live={live} notice={notice} titleRef={titleRef} />
  )
}

interface ViewProps {
  event: EventData
  live: UseEvent
  notice: ReactNode
  titleRef: RefObject<HTMLHeadingElement | null>
}

function OpenEvent({ event, live, notice, titleRef }: ViewProps) {
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
        titleRef={titleRef}
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

function ClosedEvent({ event, live, notice, titleRef }: ViewProps) {
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
        titleRef={titleRef}
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

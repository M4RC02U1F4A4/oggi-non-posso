import type { ReactNode } from 'react'
import type { EventData, Participant } from '../api/types'
import { isolate, joinNodes, t, tNodes } from '../i18n'
import { capitalise, formatDayLong } from '../lib/dates'
import { slotsText, summarise } from '../lib/result'
import { VoteTable } from './VoteTable'
import '../styles/ResultView.css'

/** Where "see the whole calendar" lands. */
export const CALENDAR_ID = 'calendar'

interface ResultViewProps {
  event: EventData
  /** Shown under the calendar: the organiser's controls. */
  children?: ReactNode
}

const CHECK = (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** "manca Anna", "manchi tu", "mancate tu e Luca": the caller first, as "tu". */
function missingText(missing: Participant[], me: string | null): ReactNode {
  const mine = missing.some((p) => p.id === me)
  const names = [
    ...(mine ? [<b key="me">{t('people.you')}</b>] : []),
    ...missing.filter((p) => p.id !== me).map((p) => <b key={p.id}>{isolate(p.name)}</b>),
  ]
  return tNodes(mine ? 'result.missingYou' : 'result.missing', { count: missing.length, names: joinNodes(names) })
}

/** The closed event: the moments everyone can make, the next best, all the days. */
export function ResultView({ event, children }: ResultViewProps) {
  const { free, rest, restHeading } = summarise(event)
  const day = (date: string) => capitalise(formatDayLong(date, true))

  return (
    <main className="wrap result">
      <div className="result__lists">
        {free.length > 0 && (
          <section className="result__section">
            <h2 className="visually-hidden">{t('result.free.title')}</h2>
            <ul className="result__list">
              {free.map((group) => (
                <li className="result__row result__free" key={`${group.date}|${group.slots[0]}`}>
                  <span className="result__check">{CHECK}</span>
                  <span className="result__when">
                    <b>{day(group.date)}</b>
                    <span>{capitalise(slotsText(group.slots))}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {restHeading !== null && (
          <section className="result__section">
            <h2 className="section-title result__title">{restHeading}</h2>
            <ul className="result__list">
              {rest.map((group) => (
                <li className="result__row result__near" key={`${group.date}|${group.slots[0]}`}>
                  <span className="result__when">
                    <b>{day(group.date)}</b>
                    <span>{capitalise(slotsText(group.slots))}</span>
                  </span>
                  <span className="result__who">{missingText(group.missing, event.me)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section className="result__calendar">
        <h2 className="section-title result__title" id={CALENDAR_ID} tabIndex={-1}>
          {t('result.calendar.title')}
        </h2>
        <p className="result__note">{t('result.calendar.note')}</p>
        <VoteTable event={event} mode="result" />
        {children && <div className="result__organiser">{children}</div>}
      </section>
    </main>
  )
}

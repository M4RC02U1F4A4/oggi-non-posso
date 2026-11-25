import type { ReactNode } from 'react'
import type { EventData, Participant } from '../api/types'
import { isolate, joinNodes, t, tNodes } from '../i18n'
import { capitalise, formatDayLong } from '../lib/dates'
import { slotsText, summarise } from '../lib/result'
import { VoteTable } from './VoteTable'
import '../styles/ResultView.css'

interface ResultViewProps {
  event: EventData
  /** Shown at the end: the organiser's controls. */
  children?: ReactNode
}

/** "manca Anna", "manchi tu", "mancate tu e Luca": the caller first, as "tu". */
function missingText(missing: Participant[], me: string | null): ReactNode {
  const mine = missing.some((p) => p.id === me)
  const names = [
    ...(mine ? [<b key="me">{t('people.you')}</b>] : []),
    ...missing.filter((p) => p.id !== me).map((p) => <b key={p.id}>{isolate(p.name)}</b>),
  ]
  return tNodes(mine ? 'result.missingYou' : 'result.missing', { count: missing.length, names: joinNodes(names) })
}

/**
 * The closed event: all the days first, as the recap (green where everyone
 * can), then the next best moments with who is missing.
 */
export function ResultView({ event, children }: ResultViewProps) {
  const { rest, restHeading } = summarise(event)
  const day = (date: string) => capitalise(formatDayLong(date, true))

  return (
    <main className="wrap result">
      <section className="result__calendar">
        <h2 className="section-title result__title">{t('result.calendar.title')}</h2>
        <p className="result__note">{t('result.calendar.note')}</p>
        <VoteTable event={event} mode="result" />
      </section>

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

      {children && <div className="result__organiser">{children}</div>}
    </main>
  )
}

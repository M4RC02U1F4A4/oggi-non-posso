import type { ReactNode } from 'react'
import type { EventData } from '../api/types'
import { joinList, t } from '../i18n'
import { capitalise, formatDayLong, formatDayShort, monthLong, parseDate, spansMonths } from '../lib/dates'
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

/** The closed event: the moments everyone can make, the next best, the whole table. */
export function ResultView({ event, children }: ResultViewProps) {
  const { free, rest, restHeading } = summarise(event)
  const total = event.participants.length
  // "Sabato 12" is enough while every day is in the same month.
  const withMonth = spansMonths(event.days.map((day) => day.date))

  return (
    <main className="wrap result">
      <div className="result__lists">
        {free.length > 0 && (
          <section>
            <h2 className="section-title result__free-title">
              <span>{t('result.free.title')}</span>
            </h2>
            <ul className="result__list">
              {free.map((group) => (
                <li className="result__free" key={`${group.date}|${group.slots[0]}`}>
                  <b>
                    {capitalise(formatDayLong(group.date))}
                    {withMonth && <small>{monthLong(parseDate(group.date).m)}</small>}
                  </b>
                  <span>{slotsText(group.slots)}</span>
                  <em>{t('result.free.badge', { count: total, total })}</em>
                </li>
              ))}
            </ul>
          </section>
        )}

        {restHeading !== null && (
          <section className={free.length > 0 ? 'result__rest result__rest--after' : 'result__rest'}>
            <h2 className="section-title">{restHeading}</h2>
            <ul className={withMonth ? 'result__list result__list--month' : 'result__list'}>
              {rest.map((group) => (
                <li className="result__near" key={`${group.date}|${group.slots[0]}`}>
                  <b>{formatDayShort(group.date, withMonth)}</b>
                  <span>{slotsText(group.slots)}</span>
                  <em>{t('result.without', { names: joinList(group.missing.map((p) => p.name)) })}</em>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section className="result__calendar">
        <h2 className="section-title" id={CALENDAR_ID} tabIndex={-1}>
          {t('result.calendar.title')}
        </h2>
        <VoteTable event={event} mode="result" variant="mini" />
        <p className="result__note">
          <span className="only-wide">{t('result.calendar.noteHover')}</span>
          <span className="only-narrow">{t('result.calendar.noteTap')}</span>
        </p>
        {children}
      </section>
    </main>
  )
}

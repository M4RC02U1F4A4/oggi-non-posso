import { useState } from 'react'
import { t } from '../i18n'
import {
  addMonths,
  formatFull,
  formatMonthYear,
  monthMatrix,
  parseDate,
  toISODate,
  weekdayShort, oneYearAfter } from '../lib/dates'
import '../styles/DayPicker.css'

interface DayPickerProps {
  /** Picked days, as `YYYY-MM-DD`. */
  selected: string[]
  onToggle: (date: string) => void
  /** The local calendar date of who is looking: earlier days can not be picked. */
  today: string
  /** How many days can be picked at most. */
  max: number
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

/** A month, Monday first: tap a day to pick it, tap again to unpick it. */
export function DayPicker({ selected, onToggle, today, max }: DayPickerProps) {
  const start = parseDate(today)
  const [month, setMonth] = useState({ y: start.y, m: start.m })
  const full = selected.length >= max
  const atFirstMonth = month.y === start.y && month.m === start.m
  const last = oneYearAfter(today)
  const end = parseDate(last)
  const atLastMonth = month.y === end.y && month.m === end.m
  const title = formatMonthYear(month.y, month.m)

  return (
    <section className="picker">
      <h2 className="field-label">{t('create.days.title')}</h2>
      <div className="picker__card">
        <div className="picker__nav">
          <button
            type="button"
            className="picker__arrow picker__arrow--prev"
            aria-label={t('create.days.prev')}
            disabled={atFirstMonth}
            onClick={() => setMonth(addMonths(month.y, month.m, -1))}
          />
          <b aria-live="polite">{title}</b>
          <button
            type="button"
            className="picker__arrow picker__arrow--next"
            aria-label={t('create.days.next')}
            disabled={atLastMonth}
            onClick={() => setMonth(addMonths(month.y, month.m, 1))}
          />
        </div>

        <div className="picker__grid" role="group" aria-label={title}>
          {WEEKDAYS.map((weekday) => (
            <div className="picker__weekday" aria-hidden="true" key={weekday}>
              {weekdayShort(weekday)}
            </div>
          ))}
          {monthMatrix(month.y, month.m)
            .flat()
            .map((day, index) => {
              if (day === null) return <div className="picker__blank" key={`blank-${index}`} />
              const date = toISODate(month.y, month.m, day)
              const picked = selected.includes(date)
              const past = date < today
              const tooFar = date > last
              return (
                <button
                  type="button"
                  className={picked ? 'picker__day is-on' : 'picker__day'}
                  aria-pressed={picked}
                  aria-label={
                    past
                      ? t('create.days.past', { day: formatFull(date) })
                      : tooFar
                        ? t('create.days.tooFar', { day: formatFull(date) })
                        : formatFull(date)
                  }
                  disabled={past || tooFar || (full && !picked)}
                  onClick={() => onToggle(date)}
                  key={date}
                >
                  {day}
                </button>
              )
            })}
        </div>
      </div>

      {full && (
        <p className="picker__full" role="status">
          {t('create.days.full', { max })}
        </p>
      )}
    </section>
  )
}

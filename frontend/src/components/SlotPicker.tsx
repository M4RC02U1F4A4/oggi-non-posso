import { useId, useState } from 'react'
import type { Slot } from '../api/types'
import { t } from '../i18n'
import { formatDayLong, formatMonthYear, parseDate, spansMonths, weekdayLong, weekdayShort } from '../lib/dates'
import { changedDays, daySlots, isLastSlot, type Draft } from '../lib/draft'
import { SLOTS } from '../lib/slots'
import '../styles/SlotPicker.css'

interface SlotPickerProps {
  draft: Draft
  onToggleSlot: (slot: Slot) => void
  onToggleDaySlot: (date: string, slot: Slot) => void
}

function SlotLabel({ slot }: { slot: Slot }) {
  return (
    <>
      <span className="slot-btn__long">{t(`slot.long.${slot}`)}</span>
      <span className="slot-btn__short">{t(`slot.medium.${slot}`)}</span>
    </>
  )
}

/**
 * The slots in play: five switches for the whole event, and for each picked
 * day a row of the chosen slots, to switch one off where it makes no sense.
 * On the phone the rows open from a line that says how many days differ.
 */
export function SlotPicker({ draft, onToggleSlot, onToggleDaySlot }: SlotPickerProps) {
  const [open, setOpen] = useState(false)
  const rowsId = useId()
  const withMonth = spansMonths(draft.days)
  let lastMonth = ''

  return (
    <div className="slots">
      <div className="slots__title">
        <h2>{t('create.slots.title')}</h2>
        <small>{t('create.slots.hint')}</small>
      </div>
      <div className="slots__event" role="group" aria-label={t('create.slots.title')}>
        {SLOTS.map((slot) => {
          const on = draft.slots.includes(slot)
          return (
            <button
              type="button"
              className={on ? 'slot-btn is-on' : 'slot-btn'}
              aria-pressed={on}
              disabled={on && draft.slots.length === 1}
              onClick={() => onToggleSlot(slot)}
              key={slot}
            >
              {t(`slot.long.${slot}`)}
            </button>
          )
        })}
      </div>

      <div className="slots__title slots__title--days only-wide">
        <h2>{t('create.perDay.title')}</h2>
        <small>{t('create.perDay.hint', { count: draft.days.length })}</small>
      </div>
      <button
        type="button"
        className="slots__more only-narrow"
        aria-expanded={open}
        aria-controls={rowsId}
        onClick={() => setOpen(!open)}
      >
        <span>
          {t('create.perDay.more')} <b>{t('create.perDay.changed', { count: changedDays(draft) })}</b>
        </span>
        <span className="slots__chevron" aria-hidden="true" />
      </button>

      <div id={rowsId} className={open ? 'slots__days is-open' : 'slots__days'}>
        {draft.days.length === 0 && <p className="slots__empty only-narrow">{t('create.perDay.empty')}</p>}
        {draft.days.map((date) => {
          const { y, m, d, weekday } = parseDate(date)
          const dayName = formatDayLong(date, withMonth)
          const on = daySlots(draft, date)
          const month = date.slice(0, 7)
          const monthRow = withMonth && month !== lastMonth
          lastMonth = month
          return (
            <div className="slots__group" key={date}>
              {monthRow && <p className="slots__month">{formatMonthYear(y, m)}</p>}
              <div className="slots__day" role="group" aria-label={dayName}>
                <span className="slots__name" aria-hidden="true">
                  <i>{d}</i>
                  <span className="slot-btn__long">{weekdayLong(weekday)}</span>
                  <span className="slot-btn__short">{weekdayShort(weekday)}</span>
                </span>
                <div className="slots__row" style={{ gridTemplateColumns: `repeat(${draft.slots.length}, minmax(0, 1fr))` }}>
                  {draft.slots.map((slot) => {
                    const last = isLastSlot(draft, date, slot)
                    const vars = { day: dayName, slot: t(`slot.inline.${slot}`) }
                    return (
                      <button
                        type="button"
                        className={on.includes(slot) ? 'slot-btn slot-btn--small is-on' : 'slot-btn slot-btn--small'}
                        aria-pressed={on.includes(slot)}
                        aria-label={t(last ? 'create.perDay.last' : 'create.perDay.slot', vars)}
                        disabled={last}
                        onClick={() => onToggleDaySlot(date, slot)}
                        key={slot}
                      >
                        <SlotLabel slot={slot} />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

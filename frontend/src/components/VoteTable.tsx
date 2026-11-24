import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import type { EventData, Pair, Participant } from '../api/types'
import { isolate, joinList, joinNodes, listNodes, t, tNodes, type MessageKey } from '../i18n'
import { formatDayLong, monthLong, parseDate, spansMonths, spansYears, weekdayLong, weekdayShort } from '../lib/dates'
import { cellsOf, dayPairs, type Cell } from '../lib/grid'
import '../styles/VoteTable.css'

/** How long a finger stays on a cell before the page names who is missing. */
const LONG_PRESS_MS = 450
/** How far a finger may drift and still be a press, not a scroll. */
const PRESS_SLOP_PX = 10
/** Above this many names a cell shows the first ones and how many more. */
const MAX_NAMES = 3

export interface VoteTableProps {
  event: EventData
  /**
   * `mark`: the caller taps to say "I can't"; `read`: the same table to look
   * at; `result`: the closed event, counts everywhere and yellow where
   * everyone is free.
   */
  mode: 'mark' | 'read' | 'result'
  /** `full` shows names from 900px up and counts below; `mini` always shows counts. */
  variant?: 'full' | 'mini'
  onToggle?: (pairs: Pair[]) => void
  id?: string
}

const cellKey = (cell: Cell) => `${cell.date}|${cell.slot}`

function names(people: Participant[]): string {
  return joinList(people.map((p) => p.name))
}

/** The names a cell has room for: all of them up to three, then two and a count. */
function shortNames(people: Participant[]): ReactNode {
  if (people.length <= MAX_NAMES) return listNodes(people.map((p) => isolate(p.name)))
  const shown = people.slice(0, MAX_NAMES - 1).map((p) => isolate(p.name))
  return (
    <>
      {listNodes(shown)} {t('table.more', { count: people.length - shown.length })}
    </>
  )
}

/** "Non possono Marta e Paolo", with each name kept apart. */
function missingNodes(people: Participant[]): ReactNode {
  return tNodes('peek.missing', { count: people.length, names: joinNodes(people.map((p) => isolate(p.name))) })
}

function levelClass(count: number): string {
  if (count <= 0) return ''
  return count >= 3 ? 'is-n3' : `is-n${count}`
}

export function VoteTable({ event, mode, variant = 'full', onToggle, id }: VoteTableProps) {
  const [peek, setPeek] = useState<string | null>(null)
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean; x: number; y: number }>({
    fired: false,
    x: 0,
    y: 0,
  })

  const rootRef = useRef<HTMLDivElement>(null)

  const cancelPress = () => clearTimeout(press.current.timer)

  /** With the names open, a tap only closes them. True when it did. */
  const closePeek = () => {
    if (peek === null) return false
    setPeek(null)
    return true
  }

  useEffect(() => {
    const state = press.current
    return () => clearTimeout(state.timer)
  }, [])

  // An open "who is missing" closes at the next tap, wherever it lands, or
  // on Escape. A tap outside the table closes it here; one inside is the
  // table's own business (see the click handlers): it closes the names and
  // does nothing else, so a tap on the bubble never marks the cell under it.
  useEffect(() => {
    if (peek === null) return
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (!(e.target instanceof Node) || !rootRef.current?.contains(e.target)) setPeek(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPeek(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [peek])

  const rows = cellsOf(event)
  const me = event.me
  const marking = mode === 'mark' && me !== null
  const dates = event.days.map((day) => day.date)
  const withYear = spansYears(dates)
  // "venerdì 11" names a day only while every day is in the same month.
  const withMonth = spansMonths(dates)
  const columns = event.slots.length
  const style = { '--vt-cols': columns } as CSSProperties

  const startPress = (key: string) => (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    cancelPress()
    press.current.fired = false
    press.current.x = e.clientX
    press.current.y = e.clientY
    press.current.timer = setTimeout(() => {
      press.current.fired = true
      setPeek(key)
    }, LONG_PRESS_MS)
  }

  const movePress = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > PRESS_SLOP_PX) cancelPress()
  }

  /** True when the click that follows a long press must not count as a tap. */
  const consumeLongPress = () => {
    const fired = press.current.fired
    press.current.fired = false
    return fired
  }

  let lastMonth = ''

  return (
    <div
      ref={rootRef}
      onClick={(e) => {
        // Between the buttons (a header, a slot not in play): close the names too.
        if (!(e.target instanceof Element) || !e.target.closest('button')) closePeek()
      }}
      id={id}
      role="table"
      aria-label={t('table.label')}
      className={`vt vt--${variant} vt--${mode}`}
      style={style}
    >
      <div role="row" className="vt__row">
        <div role="columnheader" className="vt__head vt__head--day">
          {variant === 'full' ? (
            <>
              <span className="only-wide">{t('table.day')}</span>
              <span className="only-narrow visually-hidden">{t('table.day')}</span>
            </>
          ) : (
            <span className="visually-hidden">{t('table.day')}</span>
          )}
        </div>
        {event.slots.map((slot) => (
          <div role="columnheader" className="vt__head" key={slot}>
            {variant === 'full' ? (
              <>
                <span className="vt__long">{t(`slot.long.${slot}`)}</span>
                <span className="vt__short">{t(`slot.short.${slot}`)}</span>
              </>
            ) : (
              <abbr title={t(`slot.long.${slot}`)}>{t(`slot.short.${slot}`)}</abbr>
            )}
          </div>
        ))}
      </div>

      {event.days.map((day, rowIndex) => {
        const cells = rows[rowIndex] ?? []
        const { y, m, d, weekday } = parseDate(day.date)
        const dayName = formatDayLong(day.date, withMonth)
        const month = day.date.slice(0, 7)
        const monthRow = month !== lastMonth
        lastMonth = month
        const allMine = marking && cells.every((cell) => !cell.candidate || cell.mine)

        const dayLabel = (
          <>
            <b className="vt__num">{d}</b>
            {variant === 'full' ? (
              <>
                <span className="vt__wd only-wide">{weekdayLong(weekday)}</span>
                <span className="vt__wd only-narrow">{weekdayShort(weekday)}</span>
              </>
            ) : (
              <span className="vt__wd">{weekdayShort(weekday)}</span>
            )}
          </>
        )

        return (
          <div role="rowgroup" className="vt__row" key={day.date}>
            {monthRow && (
              <div role="row" className="vt__row">
                <div role="cell" aria-colspan={columns + 1} className="vt__month">
                  {withYear ? t('date.monthYear', { month: monthLong(m), year: y }) : t('date.month', { month: monthLong(m) })}
                </div>
              </div>
            )}
            <div role="row" className="vt__row">
              <div role="rowheader" className="vt__day">
                {marking ? (
                  <button
                    type="button"
                    className="vt__daybtn"
                    aria-label={t(allMine ? 'day.aria.clearAll' : 'day.aria.markAll', { day: dayName })}
                    onClick={() => {
                      if (closePeek()) return
                      onToggle?.(dayPairs(day))
                    }}
                  >
                    {dayLabel}
                  </button>
                ) : (
                  <div className="vt__daybtn">{dayLabel}</div>
                )}
              </div>

              {cells.map((cell, columnIndex) => {
                const key = cellKey(cell)
                const slotName = t(`slot.inline.${cell.slot}`)
                const vars = { day: dayName, slot: slotName }
                // The names open under the cell, towards the side with more room.
                const edge = columnIndex >= (columns - 1) / 2 ? 'vt__cell--end' : ''

                if (!cell.candidate) {
                  return (
                    <div role="cell" className={`vt__cell vt__cell--off ${edge}`} key={key}>
                      <span className="visually-hidden">{t('cell.aria.off', vars)}</span>
                    </div>
                  )
                }

                const mine = marking && cell.mine
                const others = marking ? cell.missing.filter((p) => p.id !== me) : cell.missing
                const count = others.length
                const free = mode === 'result' && count === 0
                const state = mine ? 'is-mine' : free ? 'is-free' : levelClass(count)

                let label: string
                let peekText: string
                let peekContent: ReactNode
                if (marking) {
                  const base: MessageKey = mine ? 'cell.aria.mine' : 'cell.aria.free'
                  label =
                    count === 0
                      ? t(base, vars)
                      : t(`${base}Others` as MessageKey, { ...vars, count, names: names(others) })
                  peekText =
                    count > 0
                      ? t('peek.missing', { count, names: names(others) })
                      : t(mine ? 'peek.onlyYou' : 'peek.free')
                  peekContent = count > 0 ? missingNodes(others) : peekText
                } else {
                  label =
                    count === 0
                      ? t('cell.aria.readFree', vars)
                      : t('cell.aria.readMissing', { ...vars, count, names: names(others) })
                  peekText = count > 0 ? t('peek.missing', { count, names: names(others) }) : t('peek.free')
                  peekContent = count > 0 ? missingNodes(others) : peekText
                }

                const content = (
                  <>
                    {variant === 'full' && (
                      <span className="vt__names only-wide">
                        {mine && <span className="vt__mine">{t('cell.mine')}</span>}
                        {shortNames(others)}
                      </span>
                    )}
                    <span className={variant === 'full' ? 'vt__count only-narrow' : 'vt__count'} aria-hidden="true">
                      {mine ? '' : count > 0 || mode === 'result' ? count : ''}
                    </span>
                  </>
                )

                const popover = peek === key && (
                  <div className="vt__peek" role="status">
                    {peekContent}
                  </div>
                )

                if (marking) {
                  return (
                    <div role="cell" className={`vt__cell ${state} ${edge}`} key={key}>
                      <button
                        type="button"
                        className="vt__btn"
                        aria-label={label}
                        onPointerDown={startPress(key)}
                        onPointerMove={movePress}
                        onPointerUp={cancelPress}
                        onPointerLeave={cancelPress}
                        onPointerCancel={cancelPress}
                        onContextMenu={(e) => {
                          if (press.current.fired) e.preventDefault()
                        }}
                        onClick={() => {
                          if (consumeLongPress()) return
                          if (closePeek()) return
                          onToggle?.([{ date: cell.date, slot: cell.slot }])
                        }}
                      >
                        {content}
                      </button>
                      {popover}
                    </div>
                  )
                }

                // Looking only: a cell with someone missing opens the names on tap.
                return (
                  <div role="cell" className={`vt__cell ${state} ${edge}`} key={key}>
                    {count > 0 ? (
                      <button
                        type="button"
                        className="vt__btn"
                        aria-label={label}
                        aria-expanded={peek === key}
                        title={peekText}
                        onClick={() => setPeek((open) => (open === key ? null : key))}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className="vt__btn">
                        <span className="visually-hidden">{label}</span>
                        <span className="vt__shown" aria-hidden="true">
                          {content}
                        </span>
                      </div>
                    )}
                    {popover}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

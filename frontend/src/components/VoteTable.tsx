import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import type { EventData, Pair, Participant } from '../api/types'
import { isolate, joinList, joinNodes, t, tNodes, type MessageKey } from '../i18n'
import { capitalise, formatDayLong, monthLong, parseDate, spansMonths, spansYears } from '../lib/dates'
import { cellsOf, dayPairs, type Cell } from '../lib/grid'
import '../styles/VoteTable.css'

/** How long a finger stays on a slot before the page names who is missing. */
const LONG_PRESS_MS = 450
/** How far a finger may drift and still be a press, not a scroll. */
const PRESS_SLOP_PX = 10

export interface VoteTableProps {
  event: EventData
  /**
   * `mark`: the caller taps to say "I can't"; `read`: the same days to look
   * at; `result`: the closed event, counts everywhere and green where
   * everyone is free.
   */
  mode: 'mark' | 'read' | 'result'
  onToggle?: (pairs: Pair[]) => void
  id?: string
}

const cellKey = (cell: Cell) => `${cell.date}|${cell.slot}`

function names(people: Participant[]): string {
  return joinList(people.map((p) => p.name))
}

/** "Non possono Marta e Paolo", with each name kept apart. */
function missingNodes(people: Participant[]): ReactNode {
  return tNodes('peek.missing', { count: people.length, names: joinNodes(people.map((p) => isolate(p.name))) })
}

/** The red badge of a slot the caller can not make. */
const CROSS = (
  <svg viewBox="0 0 14 14" width="9" height="9" aria-hidden="true" focusable="false">
    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
  </svg>
)

/** The green mark of a slot everyone can make. */
const CHECK = (
  <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * The candidate days as cards, one chip per slot of the event. The phone
 * puts a day's slots on one row; from 900px the cards sit in a grid.
 */
export function VoteTable({ event, mode, onToggle, id }: VoteTableProps) {
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
  // on Escape. A tap outside the cards closes it here; one inside is the
  // cards' own business (see the click handlers): it closes the names and
  // does nothing else, so a tap on the bubble never marks the slot under it.
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
  // Under the title of the page, or under "the whole calendar".
  const DayHeading = mode === 'result' ? 'h3' : 'h2'

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
      role="group"
      aria-label={t('table.label')}
      className={`vt vt--${mode}`}
      data-cols={columns}
      style={style}
    >
      {event.days.map((day, rowIndex) => {
        const cells = rows[rowIndex] ?? []
        const { y, m } = parseDate(day.date)
        const dayName = formatDayLong(day.date, withMonth)
        const month = day.date.slice(0, 7)
        const monthHeading = withMonth && month !== lastMonth
        lastMonth = month
        const allMine = marking && cells.every((cell) => !cell.candidate || cell.mine)

        return (
          <Fragment key={day.date}>
            {monthHeading && (
              <p className="vt__month">
                {withYear ? t('date.monthYear', { month: monthLong(m), year: y }) : t('date.month', { month: monthLong(m) })}
              </p>
            )}
            <div className="vt__day">
              <div className="vt__head">
                <DayHeading className="vt__name">{capitalise(formatDayLong(day.date, true))}</DayHeading>
                {marking && (
                  <button
                    type="button"
                    className="link-btn vt__all"
                    aria-label={t(allMine ? 'day.aria.clearAll' : 'day.aria.markAll', { day: dayName })}
                    onClick={() => {
                      if (closePeek()) return
                      onToggle?.(dayPairs(day))
                    }}
                  >
                    {t('slot.allDay')}
                  </button>
                )}
              </div>

              <div className="vt__chips">
                {cells.map((cell, columnIndex) => {
                  const key = cellKey(cell)
                  const slotName = t(`slot.inline.${cell.slot}`)
                  const vars = { day: dayName, slot: slotName }
                  // The names open under the slot, towards the side with more room:
                  // `is-end` on the phone's single row, `is-end-wide` in two columns.
                  const edge = [
                    columnIndex >= columns / 2 ? 'is-end' : '',
                    columnIndex % 2 === 1 ? 'is-end-wide' : '',
                  ].join(' ')
                  const slotLabel = (
                    <span className="vt__label" aria-hidden="true">
                      <span className="vt__long">{t(`slot.long.${cell.slot}`)}</span>
                      <span className="vt__short">{t(`slot.medium.${cell.slot}`)}</span>
                    </span>
                  )

                  if (!cell.candidate) {
                    return (
                      <div className={`vt__cell ${edge}`} key={key}>
                        <div className="vt__chip is-off">
                          {slotLabel}
                          <span className="visually-hidden">{t('cell.aria.off', vars)}</span>
                        </div>
                      </div>
                    )
                  }

                  const mine = marking && cell.mine
                  const others = marking ? cell.missing.filter((p) => p.id !== me) : cell.missing
                  const count = others.length
                  const free = mode === 'result' && count === 0
                  const state = mine ? 'is-mine' : free ? 'is-free' : ''

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
                      {slotLabel}
                      {!mine && count > 0 && (
                        <span className="vt__count" aria-hidden="true">
                          {t('cell.count', { count })}
                        </span>
                      )}
                      {mine && <span className="vt__badge">{CROSS}</span>}
                      {free && <span className="vt__ok">{CHECK}</span>}
                    </>
                  )

                  const popover = peek === key && (
                    <div className="vt__peek" role="status">
                      {peekContent}
                    </div>
                  )

                  if (marking) {
                    return (
                      <div className={`vt__cell ${edge}`} key={key}>
                        <button
                          type="button"
                          className={`vt__chip ${state}`}
                          aria-label={label}
                          aria-pressed={mine}
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

                  // Looking only: a slot with someone missing opens the names on tap.
                  return (
                    <div className={`vt__cell ${edge}`} key={key}>
                      {count > 0 ? (
                        <button
                          type="button"
                          className={`vt__chip ${state}`}
                          aria-label={label}
                          aria-expanded={peek === key}
                          title={peekText}
                          onClick={() => setPeek((open) => (open === key ? null : key))}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={`vt__chip ${state}`}>
                          <span className="visually-hidden">{label}</span>
                          {content}
                        </div>
                      )}
                      {popover}
                    </div>
                  )
                })}
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

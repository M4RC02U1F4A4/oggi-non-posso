// Calendar dates as `YYYY-MM-DD` strings. Nothing here builds a Date from
// such a string: a date is a day on the calendar, not an instant, and must
// read the same in every time zone.

import { t, type MessageKey } from '../i18n'

export interface DateParts {
  y: number
  /** 1 to 12. */
  m: number
  d: number
  /** 0 = Monday … 6 = Sunday. */
  weekday: number
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31
}

const MONTH_OFFSETS = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const

/** Day of the week by arithmetic (Sakamoto's method); 0 = Monday … 6 = Sunday. */
export function weekdayOf(y: number, m: number, d: number): number {
  const year = m < 3 ? y - 1 : y
  const sundayFirst =
    (year +
      Math.floor(year / 4) -
      Math.floor(year / 100) +
      Math.floor(year / 400) +
      (MONTH_OFFSETS[m - 1] as number) +
      d) %
    7
  return (sundayFirst + 6) % 7
}

export function isValidDate(s: string): boolean {
  const match = ISO_DATE.exec(s)
  if (!match) return false
  const m = Number(match[2])
  const d = Number(match[3])
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(Number(match[1]), m)
}

export function parseDate(s: string): DateParts {
  const match = ISO_DATE.exec(s)
  if (!match || !isValidDate(s)) throw new Error(`not a calendar date: ${s}`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  return { y, m, d, weekday: weekdayOf(y, m, d) }
}

export function toISODate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** The browser's local calendar date: "today" for the person looking. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/**
 * The same day one year later, 28 February for 29 February. The last day an
 * event may use: the server takes dates up to a year ahead.
 */
export function oneYearAfter(date: string): string {
  const { y, m, d } = parseDate(date)
  return toISODate(y + 1, m, Math.min(d, daysInMonth(y + 1, m)))
}

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + delta
  return { y: Math.floor(index / 12), m: (((index % 12) + 12) % 12) + 1 }
}

/** The weeks of a month, Monday first; null where the week belongs to another month. */
export function monthMatrix(y: number, m: number): (number | null)[][] {
  const cells: (number | null)[] = []
  for (let i = weekdayOf(y, m, 1); i > 0; i--) cells.push(null)
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// Formatting, from the parts and the catalogue.

export function weekdayLong(weekday: number): string {
  return t(`weekday.long.${weekday}` as MessageKey)
}

export function weekdayShort(weekday: number): string {
  return t(`weekday.short.${weekday}` as MessageKey)
}

export function monthLong(m: number): string {
  return t(`month.long.${m}` as MessageKey)
}

export function monthShort(m: number): string {
  return t(`month.short.${m}` as MessageKey)
}

/** "venerdì 11", or "venerdì 11 dicembre" with the month. */
export function formatDayLong(date: string, withMonth = false): string {
  const { m, d, weekday } = parseDate(date)
  return withMonth
    ? t('date.dayLongMonth', { weekday: weekdayLong(weekday), day: d, month: monthLong(m) })
    : t('date.dayLong', { weekday: weekdayLong(weekday), day: d })
}

/** "ven 11", or "ven 11 dic" with the month. */
export function formatDayShort(date: string, withMonth = false): string {
  const { m, d, weekday } = parseDate(date)
  return withMonth
    ? t('date.dayShortMonth', { weekday: weekdayShort(weekday), day: d, month: monthShort(m) })
    : t('date.dayShort', { weekday: weekdayShort(weekday), day: d })
}

/** "venerdì 11 dicembre 2026". */
export function formatFull(date: string): string {
  const { y, m, d, weekday } = parseDate(date)
  return t('date.full', { weekday: weekdayLong(weekday), day: d, month: monthLong(m), year: y })
}

/** "dicembre 2026". */
export function formatMonthYear(y: number, m: number): string {
  return t('date.monthYear', { month: monthLong(m), year: y })
}

export function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase('it') + text.slice(1)
}

/** True when the dates do not all fall in one month of one year. */
export function spansMonths(dates: string[]): boolean {
  return new Set(dates.map((date) => date.slice(0, 7))).size > 1
}

/** True when the dates do not all fall in one year. */
export function spansYears(dates: string[]): boolean {
  return new Set(dates.map((date) => date.slice(0, 4))).size > 1
}

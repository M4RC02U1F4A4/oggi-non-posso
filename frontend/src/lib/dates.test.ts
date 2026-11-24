import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addMonths,
  daysInMonth,
  formatDayLong,
  formatDayShort,
  formatFull,
  isValidDate,
  monthMatrix,
  parseDate,
  spansMonths,
  todayISO, oneYearAfter } from './dates'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseDate', () => {
  it('reads 2026-12-11 as Friday 11 December', () => {
    expect(parseDate('2026-12-11')).toEqual({ y: 2026, m: 12, d: 11, weekday: 4 })
    expect(formatFull('2026-12-11')).toBe('venerdì 11 dicembre 2026')
    expect(formatDayLong('2026-12-11')).toBe('venerdì 11')
    expect(formatDayShort('2026-12-11')).toBe('ven 11')
    expect(formatDayShort('2026-12-11', true)).toBe('ven 11 dic')
  })

  it('reads the leap day 2028-02-29 as a Tuesday', () => {
    expect(parseDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29, weekday: 1 })
  })

  // Kiritimati is UTC+14 and Pago Pago UTC-11: a date pushed through a Date
  // would land on a different day in one of the two.
  it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago'])('gives the same answer in %s', (zone) => {
    vi.stubEnv('TZ', zone)
    expect(new Date(2026, 11, 11).getTimezoneOffset()).toBe(zone === 'Pacific/Kiritimati' ? -840 : 660)
    expect(parseDate('2026-12-11')).toEqual({ y: 2026, m: 12, d: 11, weekday: 4 })
    expect(formatDayLong('2026-12-11')).toBe('venerdì 11')
    expect(parseDate('2028-02-29').weekday).toBe(1)
  })

  it('rejects what is not a calendar date', () => {
    expect(() => parseDate('2026-02-30')).toThrow()
    expect(() => parseDate('11/12/2026')).toThrow()
    expect(isValidDate('2026-02-28')).toBe(true)
    expect(isValidDate('2027-02-29')).toBe(false)
    expect(isValidDate('2026-13-01')).toBe(false)
  })
})

describe('month arithmetic', () => {
  it('knows the length of months', () => {
    expect(daysInMonth(2026, 12)).toBe(31)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2100, 2)).toBe(28)
    expect(daysInMonth(2026, 4)).toBe(30)
  })

  it('moves across years', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ y: 2027, m: 1 })
    expect(addMonths(2027, 1, -1)).toEqual({ y: 2026, m: 12 })
    expect(addMonths(2026, 11, 14)).toEqual({ y: 2028, m: 1 })
  })

  it('lays out December 2026: starts on a Tuesday, 31 days', () => {
    const weeks = monthMatrix(2026, 12)
    expect(weeks).toHaveLength(5)
    expect(weeks[0]).toEqual([null, 1, 2, 3, 4, 5, 6])
    expect(weeks[4]).toEqual([28, 29, 30, 31, null, null, null])
  })

  it('lays out February 2028: starts on a Tuesday, 29 days', () => {
    const weeks = monthMatrix(2028, 2)
    expect(weeks).toHaveLength(5)
    expect(weeks[0]).toEqual([null, 1, 2, 3, 4, 5, 6])
    expect(weeks[4]).toEqual([28, 29, null, null, null, null, null])
  })

  it('takes today from the local calendar', () => {
    expect(todayISO(new Date(2026, 10, 24, 23, 59))).toBe('2026-11-24')
    expect(todayISO(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01')
  })

  it('tells when days fall in more than one month', () => {
    expect(spansMonths(['2026-12-11', '2026-12-20'])).toBe(false)
    expect(spansMonths(['2026-12-30', '2027-01-02'])).toBe(true)
  })
})

describe('oneYearAfter', () => {
  it('is the same day a year later, 28 February for 29 February', () => {
    expect(oneYearAfter('2026-11-24')).toBe('2027-11-24')
    expect(oneYearAfter('2028-02-29')).toBe('2029-02-28')
    expect(oneYearAfter('2026-12-31')).toBe('2027-12-31')
  })
})

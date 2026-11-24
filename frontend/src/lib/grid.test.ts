import { describe, expect, it } from 'vitest'
import { fixtureEvent, idOf } from '../test/fixture'
import { cellsOf, countMarked, dayPairs, isCandidate } from './grid'

describe('cellsOf', () => {
  const event = fixtureEvent('Anna')
  const cells = cellsOf(event)
  const cell = (date: string, slot: string) => {
    const found = cells.flat().find((c) => c.date === date && c.slot === slot)
    if (!found) throw new Error(`no cell ${date} ${slot}`)
    return found
  }

  it('has a row per day and a cell per slot of the event', () => {
    expect(cells).toHaveLength(6)
    for (const row of cells) expect(row.map((c) => c.slot)).toEqual(event.slots)
  })

  it('names who is missing', () => {
    expect(cell('2026-12-13', 'afternoon').missing.map((p) => p.name)).toEqual(['Luca'])
    expect(cell('2026-12-18', 'afternoon').missing.map((p) => p.name)).toEqual(['Luca', 'Anna', 'Marta', 'Paolo'])
    expect(cell('2026-12-12', 'afternoon').missing).toEqual([])
  })

  it('knows a slot that is not in play on a day', () => {
    expect(cell('2026-12-11', 'morning')).toMatchObject({ candidate: false, missing: [], mine: false })
    expect(cell('2026-12-11', 'afternoon').candidate).toBe(true)
  })

  it('marks as mine only the absences of the caller', () => {
    const mine = cells
      .flat()
      .filter((c) => c.mine)
      .map((c) => `${c.date} ${c.slot}`)
    expect(mine).toEqual([
      '2026-12-12 morning',
      '2026-12-12 lunch',
      '2026-12-13 morning',
      '2026-12-18 afternoon',
      '2026-12-18 dinner',
      '2026-12-18 after_dinner',
      '2026-12-20 after_dinner',
    ])
    expect(cellsOf(fixtureEvent()).flat().some((c) => c.mine)).toBe(false)
  })
})

describe('countMarked', () => {
  it('counts the pairs a participant marked', () => {
    const event = fixtureEvent()
    expect(countMarked(event, idOf('Anna'))).toBe(7)
    expect(countMarked(event, idOf('Luca'))).toBe(11)
    expect(countMarked(event, 'nobody')).toBe(0)
  })
})

describe('candidates', () => {
  const event = fixtureEvent()

  it('lists the pairs of a whole day', () => {
    expect(dayPairs(event.days[0]!)).toEqual([
      { date: '2026-12-11', slot: 'afternoon' },
      { date: '2026-12-11', slot: 'dinner' },
      { date: '2026-12-11', slot: 'after_dinner' },
    ])
  })

  it('tells a candidate pair from one that is not', () => {
    expect(isCandidate(event, { date: '2026-12-11', slot: 'dinner' })).toBe(true)
    expect(isCandidate(event, { date: '2026-12-11', slot: 'lunch' })).toBe(false)
    expect(isCandidate(event, { date: '2026-12-14', slot: 'dinner' })).toBe(false)
  })
})

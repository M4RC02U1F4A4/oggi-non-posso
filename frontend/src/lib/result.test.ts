import { describe, expect, it } from 'vitest'
import type { Alternative } from '../api/types'
import { closedFixtureEvent, idOf } from '../test/fixture'
import { slotsText, summarise } from './result'

const closedWith = (alternatives: Alternative[]) => closedFixtureEvent(null, { alternatives })

describe('summarise', () => {
  it('reads the fixture: three moments for everyone, then one missing', () => {
    const summary = summarise(closedFixtureEvent())
    expect(summary.headline).toBe('Ci siete tutti in tre momenti')
    expect(summary.free.map((g) => `${g.date} ${slotsText(g.slots)}`)).toEqual([
      '2026-12-11 dopocena',
      '2026-12-12 pomeriggio e cena',
      '2026-12-20 pranzo e pomeriggio',
    ])
    expect(summary.restHeading).toBe('Se manca una persona sola')
    expect(summary.rest).toHaveLength(7)
    expect(summary.rest[0]).toMatchObject({ date: '2026-12-11', slots: ['dinner'] })
    expect(summary.rest.map((g) => g.missing.map((p) => p.name).join())).toEqual([
      'Luca',
      'Anna',
      'Marta',
      'Luca',
      'Anna',
      'Marta',
      'Paolo',
    ])
  })

  it('says so when there is one moment only', () => {
    const summary = summarise(closedWith([{ date: '2026-12-12', slots: ['dinner'], missing: [] }]))
    expect(summary.headline).toBe('Ci siete tutti in un momento')
    expect(summary.rest).toEqual([])
    expect(summary.restHeading).toBeNull()
  })

  it('has no moment for everyone when the best is one missing', () => {
    const summary = summarise(
      closedWith([
        { date: '2026-12-12', slots: ['lunch'], missing: [idOf('Anna')] },
        { date: '2026-12-20', slots: ['dinner'], missing: [idOf('Paolo')] },
      ]),
    )
    expect(summary.headline).toBe('Non c’è un momento per tutti')
    expect(summary.free).toEqual([])
    expect(summary.restHeading).toBe('Se manca una persona sola')
  })

  it('names the best tier when more than one is missing everywhere', () => {
    const summary = summarise(
      closedWith([{ date: '2026-12-13', slots: ['dinner'], missing: [idOf('Paolo'), idOf('Marta')] }]),
    )
    expect(summary.headline).toBe('Non c’è un momento per tutti')
    expect(summary.restHeading).toBe('Se mancano due persone')
    expect(summary.rest[0]?.missing.map((p) => p.name)).toEqual(['Paolo', 'Marta'])
  })

  it('copes with an event that has no alternatives at all', () => {
    const summary = summarise(closedWith([]))
    expect(summary.headline).toBe('Non c’è un momento per tutti')
    expect(summary.restHeading).toBeNull()
  })
})

describe('slotsText', () => {
  it('lists slots as a sentence does', () => {
    expect(slotsText(['dinner'])).toBe('cena')
    expect(slotsText(['lunch', 'afternoon', 'dinner'])).toBe('pranzo, pomeriggio e cena')
    expect(slotsText(['morning', 'lunch', 'afternoon', 'dinner', 'after_dinner'])).toBe('tutto il giorno')
  })
})

import { describe, expect, it } from 'vitest'
import type { Pair } from '../api/types'
import { closedFixtureEvent, fixtureEvent, idOf } from '../test/fixture'
import { applyChanges, mergeChanges, toggleChange } from './absences'
import { dayPairs } from './grid'

const pair = (day: number, slot: Pair['slot']): Pair => ({ date: `2026-12-${day}`, slot })

describe('toggleChange', () => {
  const event = fixtureEvent('Anna')

  it('marks a free cell and clears a marked one', () => {
    expect(toggleChange(event, [pair(12, 'dinner')])).toEqual({ set: [pair(12, 'dinner')], clear: [] })
    expect(toggleChange(event, [pair(12, 'lunch')])).toEqual({ set: [], clear: [pair(12, 'lunch')] })
  })

  it('marks the rest of a day that is partly marked, clears a day that is all marked', () => {
    const saturday = dayPairs(event.days[1]!)
    expect(toggleChange(event, saturday)).toEqual({
      set: [pair(12, 'afternoon'), pair(12, 'dinner'), pair(12, 'after_dinner')],
      clear: [],
    })
    const friday = dayPairs(event.days[3]!)
    expect(toggleChange(event, friday)).toEqual({ set: [], clear: friday })
  })

  it('does nothing for a visitor, a closed event or a pair that is not a candidate', () => {
    expect(toggleChange(fixtureEvent(), [pair(12, 'dinner')])).toBeNull()
    expect(toggleChange(closedFixtureEvent('Anna'), [pair(12, 'dinner')])).toBeNull()
    expect(toggleChange(event, [pair(11, 'morning')])).toBeNull()
  })
})

describe('mergeChanges', () => {
  it('keeps the latest change of each pair', () => {
    expect(
      mergeChanges([
        { set: [pair(12, 'dinner'), pair(13, 'dinner')], clear: [] },
        { set: [], clear: [pair(12, 'dinner')] },
        { set: [pair(20, 'lunch')], clear: [] },
      ]),
    ).toEqual({ set: [pair(13, 'dinner'), pair(20, 'lunch')], clear: [pair(12, 'dinner')] })
  })
})

describe('applyChanges', () => {
  const event = fixtureEvent('Anna')
  const anna = (e: typeof event) => e.participants.find((p) => p.id === idOf('Anna'))!

  it('shows pending marks on the caller only, slots in canonical order', () => {
    const shown = applyChanges(event, [
      { set: [pair(12, 'after_dinner'), pair(11, 'dinner')], clear: [] },
      { set: [], clear: [pair(20, 'after_dinner'), pair(12, 'morning')] },
    ])
    expect(anna(shown).absences).toEqual({
      '2026-12-11': ['dinner'],
      '2026-12-12': ['lunch', 'after_dinner'],
      '2026-12-13': ['morning'],
      '2026-12-18': ['afternoon', 'dinner', 'after_dinner'],
    })
    expect(shown.participants.filter((p) => p.id !== idOf('Anna'))).toEqual(
      event.participants.filter((p) => p.id !== idOf('Anna')),
    )
    expect(anna(event).absences['2026-12-20']).toEqual(['after_dinner'])
  })

  it('returns the event untouched when there is nothing pending or nobody to apply it to', () => {
    expect(applyChanges(event, [])).toBe(event)
    const visitor = fixtureEvent()
    expect(applyChanges(visitor, [{ set: [pair(12, 'dinner')], clear: [] }])).toBe(visitor)
  })
})

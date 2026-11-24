import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT,
  changedDays,
  daySlots,
  isLastSlot,
  toEventDays,
  toggleDay,
  toggleDaySlot,
  toggleEventSlot,
  type Draft,
} from './draft'

const FRIDAY = '2026-12-11'
const SATURDAY = '2026-12-12'

const pick = (...dates: string[]) => dates.reduce((draft, date) => toggleDay(draft, date), EMPTY_DRAFT)

describe('days', () => {
  it('starts with no day and every slot', () => {
    expect(EMPTY_DRAFT.days).toEqual([])
    expect(EMPTY_DRAFT.slots).toEqual(['morning', 'lunch', 'afternoon', 'dinner', 'after_dinner'])
  })

  it('keeps picked days in order, and unpicks on a second tap', () => {
    const draft = pick(SATURDAY, '2027-01-02', FRIDAY)
    expect(draft.days).toEqual([FRIDAY, SATURDAY, '2027-01-02'])
    expect(toggleDay(draft, SATURDAY).days).toEqual([FRIDAY, '2027-01-02'])
  })

  it('takes at most the given number of days, and still lets one go', () => {
    const full = toggleDay(toggleDay(EMPTY_DRAFT, FRIDAY, 2), SATURDAY, 2)
    expect(toggleDay(full, '2026-12-13', 2)).toBe(full)
    expect(toggleDay(full, FRIDAY, 2).days).toEqual([SATURDAY])
  })

  it('forgets what was switched off on a day that is unpicked', () => {
    const draft = toggleDaySlot(pick(FRIDAY), FRIDAY, 'morning')
    expect(toggleDay(toggleDay(draft, FRIDAY), FRIDAY).off).toEqual({})
  })
})

describe('slots of the event', () => {
  it('switches a slot off and on again, in canonical order', () => {
    const without = toggleEventSlot(EMPTY_DRAFT, 'lunch')
    expect(without.slots).toEqual(['morning', 'afternoon', 'dinner', 'after_dinner'])
    expect(toggleEventSlot(without, 'lunch').slots).toEqual(EMPTY_DRAFT.slots)
  })

  it('keeps the last slot on', () => {
    let draft: Draft = EMPTY_DRAFT
    for (const slot of ['morning', 'lunch', 'afternoon', 'after_dinner'] as const) draft = toggleEventSlot(draft, slot)
    expect(draft.slots).toEqual(['dinner'])
    expect(toggleEventSlot(draft, 'dinner')).toBe(draft)
  })

  it('gives all the slots back to a day that would be left with none', () => {
    let draft = pick(FRIDAY, SATURDAY)
    for (const slot of ['morning', 'lunch', 'afternoon', 'after_dinner'] as const) {
      draft = toggleDaySlot(draft, FRIDAY, slot)
    }
    expect(daySlots(draft, FRIDAY)).toEqual(['dinner'])

    draft = toggleEventSlot(draft, 'dinner')
    expect(daySlots(draft, FRIDAY)).toEqual(['morning', 'lunch', 'afternoon', 'after_dinner'])
    expect(daySlots(draft, SATURDAY)).toEqual(['morning', 'lunch', 'afternoon', 'after_dinner'])
    expect(changedDays(draft)).toBe(0)
  })
})

describe('slots of a day', () => {
  it('switches a slot off on one day only', () => {
    const draft = toggleDaySlot(toggleDaySlot(pick(FRIDAY, SATURDAY), FRIDAY, 'lunch'), FRIDAY, 'morning')
    expect(daySlots(draft, FRIDAY)).toEqual(['afternoon', 'dinner', 'after_dinner'])
    expect(daySlots(draft, SATURDAY)).toEqual(EMPTY_DRAFT.slots)
    expect(changedDays(draft)).toBe(1)
    expect(changedDays(toggleDaySlot(toggleDaySlot(draft, FRIDAY, 'lunch'), FRIDAY, 'morning'))).toBe(0)
  })

  it('does not let a day lose its last slot', () => {
    let draft = pick(FRIDAY)
    for (const slot of ['morning', 'lunch', 'afternoon', 'after_dinner'] as const) {
      draft = toggleDaySlot(draft, FRIDAY, slot)
    }
    expect(isLastSlot(draft, FRIDAY, 'dinner')).toBe(true)
    expect(isLastSlot(draft, FRIDAY, 'lunch')).toBe(false)
    expect(toggleDaySlot(draft, FRIDAY, 'dinner')).toBe(draft)
  })

  it('ignores a slot the event does not have', () => {
    const draft = toggleEventSlot(pick(FRIDAY), 'morning')
    expect(toggleDaySlot(draft, FRIDAY, 'morning')).toBe(draft)
  })
})

describe('toEventDays', () => {
  it('gives the API a list of slots per day', () => {
    const draft = toggleDaySlot(toggleEventSlot(pick(SATURDAY, FRIDAY), 'morning'), FRIDAY, 'lunch')
    expect(toEventDays(draft)).toEqual([
      { date: FRIDAY, slots: ['afternoon', 'dinner', 'after_dinner'] },
      { date: SATURDAY, slots: ['lunch', 'afternoon', 'dinner', 'after_dinner'] },
    ])
  })
})

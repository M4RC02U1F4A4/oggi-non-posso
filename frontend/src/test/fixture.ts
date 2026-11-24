// The example of the implementation plan: five people, six days of December
// 2026, the two Fridays without morning and lunch. Invented data.

import type { Alternative, EventData, EventDay, Participant, Slot } from '../api/types'

const ALL: Slot[] = ['morning', 'lunch', 'afternoon', 'dinner', 'after_dinner']
const EVENING: Slot[] = ['afternoon', 'dinner', 'after_dinner']

export const DAYS: EventDay[] = [
  { date: '2026-12-11', slots: EVENING },
  { date: '2026-12-12', slots: ALL },
  { date: '2026-12-13', slots: ALL },
  { date: '2026-12-18', slots: EVENING },
  { date: '2026-12-19', slots: ALL },
  { date: '2026-12-20', slots: ALL },
]

// Who is absent where: date → slot → names.
const ABSENT: Record<string, Partial<Record<Slot, string[]>>> = {
  '2026-12-11': { afternoon: ['Luca', 'Paolo', 'Marta'], dinner: ['Luca'] },
  '2026-12-12': { morning: ['Anna', 'Paolo'], lunch: ['Anna'], after_dinner: ['Marta'] },
  '2026-12-13': {
    morning: ['Giulia', 'Luca', 'Anna'],
    lunch: ['Luca'],
    afternoon: ['Luca'],
    dinner: ['Paolo', 'Marta'],
    after_dinner: ['Paolo', 'Marta', 'Giulia'],
  },
  '2026-12-18': { afternoon: ['Luca', 'Paolo', 'Marta', 'Anna'], dinner: ['Anna'], after_dinner: ['Anna'] },
  '2026-12-19': {
    morning: ['Giulia', 'Luca', 'Paolo'],
    lunch: ['Giulia', 'Luca'],
    afternoon: ['Giulia', 'Luca'],
    dinner: ['Giulia', 'Luca'],
    after_dinner: ['Giulia', 'Luca', 'Marta'],
  },
  '2026-12-20': { morning: ['Marta'], dinner: ['Paolo'], after_dinner: ['Paolo', 'Anna'] },
}

const NAMES = ['Giulia', 'Luca', 'Anna', 'Marta', 'Paolo']

// Ids and keys are random UUIDs; these are plainly not random.
export const EVENT_ID = '11111111-2222-4333-8444-555555555555'
/** The organiser key of the fixture. */
export const ORGANISER_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
/** Another well-formed key: one already stored, or one that is not the event's. */
export const OTHER_KEY = '99999999-8888-4777-8666-000000000000'

export const idOf = (name: string) => `id-${name.toLowerCase()}`

function participant(name: string): Participant {
  const absences: Record<string, Slot[]> = {}
  for (const day of DAYS) {
    const slots = day.slots.filter((slot) => ABSENT[day.date]?.[slot]?.includes(name))
    if (slots.length > 0) absences[day.date] = slots
  }
  return { id: idOf(name), name, organiser: name === 'Giulia', absences }
}

const alternative = (day: number, slots: Slot[], missing: string[] = []): Alternative => ({
  date: `2026-12-${day}`,
  slots,
  missing: missing.map(idOf),
})

/** What the backend answers for the fixture once it is closed. */
export const ALTERNATIVES: Alternative[] = [
  alternative(11, ['after_dinner']),
  alternative(12, ['afternoon', 'dinner']),
  alternative(20, ['lunch', 'afternoon']),
  alternative(11, ['dinner'], ['Luca']),
  alternative(12, ['lunch'], ['Anna']),
  alternative(12, ['after_dinner'], ['Marta']),
  alternative(13, ['lunch', 'afternoon'], ['Luca']),
  alternative(18, ['dinner', 'after_dinner'], ['Anna']),
  alternative(20, ['morning'], ['Marta']),
  alternative(20, ['dinner'], ['Paolo']),
]

/** The open event, seen by `me` (a name) or by a visitor. */
export function fixtureEvent(me: string | null = null, overrides: Partial<EventData> = {}): EventData {
  return {
    id: EVENT_ID,
    title: 'Rimpatriata di dicembre',
    status: 'open',
    version: 40,
    slots: ALL,
    days: DAYS,
    participants: NAMES.map(participant),
    me: me === null ? null : idOf(me),
    can_manage: false,
    created_at: '2026-11-24T13:05:00Z',
    closed_at: null,
    alternatives: null,
    ...overrides,
  }
}

export function closedFixtureEvent(me: string | null = null, overrides: Partial<EventData> = {}): EventData {
  return fixtureEvent(me, {
    status: 'closed',
    version: 41,
    closed_at: '2026-12-01T18:30:00Z',
    alternatives: ALTERNATIVES,
    ...overrides,
  })
}

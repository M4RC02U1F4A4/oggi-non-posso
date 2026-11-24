import type { EventData, EventDay, Pair, Participant, Slot } from '../api/types'

export interface Cell {
  date: string
  slot: Slot
  /** False when this slot is not in play on this day. */
  candidate: boolean
  /** Everyone absent here, in joining order; the caller included. */
  missing: Participant[]
  /** True when the caller is one of them. */
  mine: boolean
}

export function isAbsent(participant: Participant, date: string, slot: Slot): boolean {
  return participant.absences[date]?.includes(slot) ?? false
}

/** One row per day, one cell per slot of the event (the union of the days' slots). */
export function cellsOf(event: EventData): Cell[][] {
  return event.days.map((day) =>
    event.slots.map((slot) => {
      const candidate = day.slots.includes(slot)
      const missing = candidate ? event.participants.filter((p) => isAbsent(p, day.date, slot)) : []
      return {
        date: day.date,
        slot,
        candidate,
        missing,
        mine: event.me !== null && missing.some((p) => p.id === event.me),
      }
    }),
  )
}

/** How many (day, slot) pairs a participant marked. */
export function countMarked(event: EventData, participantId: string): number {
  const participant = event.participants.find((p) => p.id === participantId)
  if (!participant) return 0
  return Object.values(participant.absences).reduce((total, slots) => total + slots.length, 0)
}

/** The candidate pairs of one day: what "the whole day" means. */
export function dayPairs(day: EventDay): Pair[] {
  return day.slots.map((slot) => ({ date: day.date, slot }))
}

export function isCandidate(event: EventData, pair: Pair): boolean {
  return event.days.some((day) => day.date === pair.date && day.slots.includes(pair.slot))
}

export function findParticipant(event: EventData, id: string | null): Participant | undefined {
  return id === null ? undefined : event.participants.find((p) => p.id === id)
}

export function organiserOf(event: EventData): Participant | undefined {
  return event.participants.find((p) => p.organiser)
}

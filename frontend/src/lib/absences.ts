// Changes to the caller's absences that the server has not confirmed yet,
// and how the page shows them in the meantime.

import type { AbsenceChange, EventData, Pair, Slot } from '../api/types'
import { findParticipant, isAbsent, isCandidate } from './grid'
import { sortSlots } from './slots'

const keyOf = (pair: Pair) => `${pair.date}|${pair.slot}`

/**
 * What a tap means. If every one of the pairs is already marked the tap
 * clears them all; otherwise it marks the ones that are not. One pair is a
 * cell; a day's pairs are "the whole day". Null when there is nothing to do.
 */
export function toggleChange(event: EventData, pairs: Pair[]): AbsenceChange | null {
  const me = findParticipant(event, event.me)
  if (!me || event.status !== 'open') return null
  const wanted = pairs.filter((pair) => isCandidate(event, pair))
  if (wanted.length === 0) return null
  const unmarked = wanted.filter((pair) => !isAbsent(me, pair.date, pair.slot))
  return unmarked.length === 0 ? { set: [], clear: wanted } : { set: unmarked, clear: [] }
}

/** Several changes as one request: for each pair the latest change wins. */
export function mergeChanges(changes: AbsenceChange[]): AbsenceChange {
  const latest = new Map<string, { pair: Pair; set: boolean }>()
  for (const change of changes) {
    for (const pair of change.set) latest.set(keyOf(pair), { pair, set: true })
    for (const pair of change.clear) latest.set(keyOf(pair), { pair, set: false })
  }
  const all = [...latest.values()]
  return {
    set: all.filter((entry) => entry.set).map((entry) => entry.pair),
    clear: all.filter((entry) => !entry.set).map((entry) => entry.pair),
  }
}

/** The event as the page shows it: the server's, plus the caller's pending changes. */
export function applyChanges(event: EventData, changes: AbsenceChange[]): EventData {
  if (event.me === null || changes.length === 0) return event
  const me = findParticipant(event, event.me)
  if (!me) return event

  const marked = new Map<string, Set<Slot>>()
  for (const [date, slots] of Object.entries(me.absences)) marked.set(date, new Set(slots))
  for (const change of changes) {
    for (const { date, slot } of change.set) {
      if (!marked.has(date)) marked.set(date, new Set())
      marked.get(date)?.add(slot)
    }
    for (const { date, slot } of change.clear) marked.get(date)?.delete(slot)
  }

  const absences: Record<string, Slot[]> = {}
  for (const date of [...marked.keys()].sort()) {
    const slots = sortSlots(marked.get(date) ?? [])
    if (slots.length > 0) absences[date] = slots
  }
  return {
    ...event,
    participants: event.participants.map((p) => (p.id === me.id ? { ...p, absences } : p)),
  }
}

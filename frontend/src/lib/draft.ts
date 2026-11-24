// The event being put together on the creation page: the days picked, the
// slots in play for the whole event, and the slots switched off on single
// days. What goes to the API is the outcome: a list of slots per day.

import type { EventDay, Slot } from '../api/types'
import { MAX_DAYS } from './limits'
import { SLOTS, sortSlots } from './slots'

export interface Draft {
  /** Picked days, ascending. */
  days: string[]
  /** Slots in play for the whole event, canonical order, never empty. */
  slots: Slot[]
  /** Slots switched off on a single day, by date. */
  off: Record<string, Slot[]>
}

export const EMPTY_DRAFT: Draft = { days: [], slots: [...SLOTS], off: {} }

/** The slots of one day: the event's, minus the ones switched off on it. */
export function daySlots(draft: Draft, date: string): Slot[] {
  const off = draft.off[date] ?? []
  return draft.slots.filter((slot) => !off.includes(slot))
}

/** Picks a day, or unpicks it. A full list takes no more days. */
export function toggleDay(draft: Draft, date: string, max: number = MAX_DAYS): Draft {
  if (draft.days.includes(date)) {
    const off = { ...draft.off }
    delete off[date]
    return { ...draft, days: draft.days.filter((day) => day !== date), off }
  }
  if (draft.days.length >= max) return draft
  return { ...draft, days: [...draft.days, date].sort() }
}

/**
 * Switches a slot on or off for the whole event. The last one stays on. A
 * day that would be left with no slot goes back to having all of them.
 */
export function toggleEventSlot(draft: Draft, slot: Slot): Draft {
  if (draft.slots.includes(slot) && draft.slots.length === 1) return draft
  const slots = draft.slots.includes(slot)
    ? draft.slots.filter((s) => s !== slot)
    : sortSlots([...draft.slots, slot])
  const off: Record<string, Slot[]> = {}
  for (const [date, list] of Object.entries(draft.off)) {
    const kept = list.filter((s) => slots.includes(s))
    if (kept.length > 0 && kept.length < slots.length) off[date] = kept
  }
  return { ...draft, slots, off }
}

/** True when the slot is the only one left on that day: it can not be switched off. */
export function isLastSlot(draft: Draft, date: string, slot: Slot): boolean {
  const slots = daySlots(draft, date)
  return slots.length === 1 && slots[0] === slot
}

/** Switches a slot on or off on one day. A day keeps at least one slot. */
export function toggleDaySlot(draft: Draft, date: string, slot: Slot): Draft {
  if (!draft.slots.includes(slot) || isLastSlot(draft, date, slot)) return draft
  const current = draft.off[date] ?? []
  const next = current.includes(slot) ? current.filter((s) => s !== slot) : sortSlots([...current, slot])
  const off = { ...draft.off }
  if (next.length === 0) delete off[date]
  else off[date] = next
  return { ...draft, off }
}

/** How many picked days differ from the event's slots. */
export function changedDays(draft: Draft): number {
  return draft.days.filter((date) => daySlots(draft, date).length !== draft.slots.length).length
}

/** The draft as the API wants it. */
export function toEventDays(draft: Draft): EventDay[] {
  return draft.days.map((date) => ({ date, slots: daySlots(draft, date) }))
}

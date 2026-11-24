import type { Slot } from '../api/types'

/** The closed set of slots, in the order every page shows them. */
export const SLOTS: readonly Slot[] = ['morning', 'lunch', 'afternoon', 'dinner', 'after_dinner']

export function slotIndex(slot: Slot): number {
  return SLOTS.indexOf(slot)
}

/** The given slots without repeats, in canonical order. */
export function sortSlots(slots: Iterable<Slot>): Slot[] {
  const wanted = new Set(slots)
  return SLOTS.filter((slot) => wanted.has(slot))
}

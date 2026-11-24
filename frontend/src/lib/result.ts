// The closed event in words. The alternatives come from the backend,
// already grouped, filtered and ordered; this only reads them.

import type { EventData, Participant, Slot } from '../api/types'
import { joinList, numberWord, t } from '../i18n'
import { SLOTS } from './slots'

export interface ResultGroup {
  date: string
  slots: Slot[]
  missing: Participant[]
}

export interface ResultSummary {
  /** "Ci siete tutti in tre momenti", or that there is no such moment. */
  headline: string
  /** The groups everyone can make. */
  free: ResultGroup[]
  /** The groups with someone missing: the next best tier. */
  rest: ResultGroup[]
  /** "Se ne manca uno solo", "Se ne mancano due"; null without such groups. */
  restHeading: string | null
}

export function summarise(event: EventData): ResultSummary {
  const byId = new Map(event.participants.map((p) => [p.id, p]))
  const groups: ResultGroup[] = (event.alternatives ?? []).map((alternative) => ({
    date: alternative.date,
    slots: alternative.slots,
    missing: alternative.missing.flatMap((id) => byId.get(id) ?? []),
  }))
  const free = groups.filter((group) => group.missing.length === 0)
  const rest = groups.filter((group) => group.missing.length > 0)
  const fewest = Math.min(...rest.map((group) => group.missing.length))
  return {
    headline: t('result.headline', { count: free.length, word: numberWord(free.length) }),
    free,
    rest,
    restHeading: rest.length === 0 ? null : t('result.tier.title', { count: fewest, word: numberWord(fewest) }),
  }
}

/** "cena", "pomeriggio e cena"; "tutto il giorno" for all five. */
export function slotsText(slots: Slot[]): string {
  if (slots.length === SLOTS.length) return t('slot.allDay')
  return joinList(slots.map((slot) => t(`slot.inline.${slot}`)))
}

// What this browser holds for an event: the participant token that says
// who it is, and the organiser key when it came through the organiser link.
// Both live in localStorage, keyed by event id.
//
// localStorage can be missing or refuse (blocked site data, some private
// windows, a full quota). What it did not take is kept in memory instead, so
// a person who just joined stays in for as long as the page is open, rather
// than being sent back to the name form with a name that is now taken.

export interface Credentials {
  participant?: string
  organiser?: string
}

const storageKey = (eventId: string) => `onp:event:${eventId}`

/** The credentials whose last write localStorage did not take, by event id. */
const unsaved = new Map<string, Credentials>()

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readStored(eventId: string): Credentials | null {
  try {
    const raw = storage()?.getItem(storageKey(eventId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { participant, organiser } = parsed as Record<string, unknown>
    const credentials: Credentials = {}
    if (typeof participant === 'string') credentials.participant = participant
    if (typeof organiser === 'string') credentials.organiser = organiser
    return credentials
  } catch {
    return null
  }
}

export function load(eventId: string): Credentials {
  // What is in memory is newer than whatever storage still holds.
  return { ...(unsaved.get(eventId) ?? readStored(eventId) ?? {}) }
}

function save(eventId: string, credentials: Credentials): void {
  try {
    const store = storage()
    if (!store) throw new Error('no storage')
    if (credentials.participant === undefined && credentials.organiser === undefined) {
      store.removeItem(storageKey(eventId))
    } else {
      store.setItem(storageKey(eventId), JSON.stringify(credentials))
    }
    unsaved.delete(eventId)
  } catch {
    unsaved.set(eventId, credentials)
  }
}

export function saveParticipant(eventId: string, token: string): void {
  save(eventId, { ...load(eventId), participant: token })
}

export function saveOrganiser(eventId: string, key: string): void {
  save(eventId, { ...load(eventId), organiser: key })
}

export function forgetParticipant(eventId: string): void {
  const { organiser } = load(eventId)
  save(eventId, organiser === undefined ? {} : { organiser })
}

// The two unique links are plain paths: `/e/<event id>` for everyone and
// `/e/<event id>/o/<organiser key>` for the organiser.

export function shareUrl(origin: string, eventId: string): string {
  return `${origin}/e/${eventId}`
}

export function organiserUrl(origin: string, eventId: string, key: string): string {
  return `${shareUrl(origin, eventId)}/o/${key}`
}

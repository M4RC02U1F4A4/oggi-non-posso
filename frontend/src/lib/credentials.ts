// What this browser holds for an event: the participant token that says
// who it is, and the organiser key when it came through the organiser link.
// Both live in localStorage, keyed by event id, and nowhere else.

export interface Credentials {
  participant?: string
  organiser?: string
}

const storageKey = (eventId: string) => `onp:event:${eventId}`

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function load(eventId: string): Credentials {
  try {
    const raw = storage()?.getItem(storageKey(eventId))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const { participant, organiser } = parsed as Record<string, unknown>
    const credentials: Credentials = {}
    if (typeof participant === 'string') credentials.participant = participant
    if (typeof organiser === 'string') credentials.organiser = organiser
    return credentials
  } catch {
    return {}
  }
}

function save(eventId: string, credentials: Credentials): void {
  try {
    const store = storage()
    if (!store) return
    if (credentials.participant === undefined && credentials.organiser === undefined) {
      store.removeItem(storageKey(eventId))
    } else {
      store.setItem(storageKey(eventId), JSON.stringify(credentials))
    }
  } catch {
    // Storage refused (private mode, quota): the page works until it is closed.
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

const ORGANISER_FRAGMENT = /^#o=(o_[A-Za-z0-9_-]+)$/

/**
 * The organiser link is `/e/<id>#o=<key>`. Stores the key for the event and
 * takes it out of the address bar, so it is not copied by accident with the
 * address. Returns true when a key was found.
 */
export function captureOrganiserKey(
  eventId: string,
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState' | 'state'>,
): boolean {
  if (!location.hash.startsWith('#o=')) return false
  const match = ORGANISER_FRAGMENT.exec(location.hash)
  if (match) saveOrganiser(eventId, match[1] as string)
  history.replaceState(history.state, '', location.pathname + location.search)
  return match !== null
}

export function shareUrl(origin: string, eventId: string): string {
  return `${origin}/e/${eventId}`
}

export function organiserUrl(origin: string, eventId: string, key: string): string {
  return `${shareUrl(origin, eventId)}#o=${key}`
}

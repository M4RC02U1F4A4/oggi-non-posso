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

const FRAGMENT_PREFIX = '#o='
// An organiser key is `o_` and 32 random bytes in base64url: 43 characters.
// A little slack on the length, none on the alphabet.
const ORGANISER_KEY = /^o_[A-Za-z0-9_-]{32,64}$/

export interface OrganiserFragment {
  /** True when the address claims to be an organiser link (`#o=…`). */
  present: boolean
  /** The key it carries, when it has the shape of one. Not yet known to be valid. */
  key: string | null
}

/**
 * Reads the fragment of an organiser link, `/e/<id>#o=<key>`. What comes out
 * is only a candidate: anyone can write such a link, so the key is stored
 * only after the server has said that it manages this event.
 */
export function readOrganiserFragment(hash: string): OrganiserFragment {
  if (!hash.startsWith(FRAGMENT_PREFIX)) return { present: false, key: null }
  const value = hash.slice(FRAGMENT_PREFIX.length)
  return { present: true, key: ORGANISER_KEY.test(value) ? value : null }
}

/**
 * Takes an organiser fragment out of the address bar, whatever it holds, so
 * a key is not copied by accident with the address and does not stay in the
 * history. Returns true when there was one.
 */
export function stripOrganiserFragment(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState' | 'state'>,
): boolean {
  if (!location.hash.startsWith(FRAGMENT_PREFIX)) return false
  history.replaceState(history.state, '', location.pathname + location.search)
  return true
}

export function shareUrl(origin: string, eventId: string): string {
  return `${origin}/e/${eventId}`
}

export function organiserUrl(origin: string, eventId: string, key: string): string {
  return `${shareUrl(origin, eventId)}#o=${key}`
}

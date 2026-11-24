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

// The two unique links are plain paths: `/e/<event id>` for everyone and
// `/e/<event id>/o/<organiser key>` for the organiser.

export function shareUrl(origin: string, eventId: string): string {
  return `${origin}/e/${eventId}`
}

export function organiserUrl(origin: string, eventId: string, key: string): string {
  return `${shareUrl(origin, eventId)}/o/${key}`
}

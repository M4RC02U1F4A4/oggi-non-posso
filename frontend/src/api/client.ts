import {
  ApiError,
  ERROR_CODES,
  type AbsenceChange,
  type CreatedEvent,
  type ErrorCode,
  type EventData,
  type JoinedEvent,
  type NewEventInput,
} from './types'

const BASE = '/api'

/** How long a request may take. One that stalls must not hold the page for ever. */
export const REQUEST_TIMEOUT_MS = 15_000

export interface RequestCredentials {
  /** Participant token, sent as `Authorization: Bearer`. */
  participant?: string
  /** Organiser key, sent as `X-Organiser-Key`. */
  organiser?: string
}

interface RequestOptions extends RequestCredentials {
  body?: unknown
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

/**
 * The code for an error answer that carries no usable JSON body: something
 * between the browser and the backend wrote it. A bare 404 or 401 is not the
 * backend saying that the event is gone or the token is refused (a proxy
 * answers like that during a deploy), so neither is taken as such: the page
 * acts on those two only when the body carries the code.
 */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'invalid_request'
    case 413:
      return 'payload_too_large'
    case 422:
      return 'validation_failed'
    case 429:
      return 'rate_limited'
    default:
      return 'internal'
  }
}

/** `Retry-After` as seconds: the header holds either a number of seconds or a date. */
function retryAfterSeconds(header: string | null): number | undefined {
  if (header === null || header.trim() === '') return undefined
  if (/^\s*\d+\s*$/.test(header)) return Number(header)
  const when = Date.parse(header)
  return Number.isNaN(when) ? undefined : Math.max(0, Math.ceil((when - Date.now()) / 1000))
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.participant) headers.Authorization = `Bearer ${options.participant}`
  if (options.organiser) headers['X-Organiser-Key'] = options.organiser
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }

  // The timeout covers the whole exchange, body included.
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS)
  init.signal = timeout.signal

  let response: Response
  let payload: unknown
  try {
    try {
      response = await fetch(BASE + path, init)
    } catch {
      // No answer: offline, refused, or it took too long.
      throw new ApiError('network', 0)
    }
    try {
      payload = await response.json()
    } catch {
      if (timeout.signal.aborted) throw new ApiError('network', 0)
      payload = undefined
    }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: unknown; message?: unknown } } | undefined)?.error
    const code = isErrorCode(error?.code) && error.code !== 'network' ? error.code : codeForStatus(response.status)
    throw new ApiError(
      code,
      response.status,
      typeof error?.message === 'string' ? error.message : undefined,
      retryAfterSeconds(response.headers.get('Retry-After')),
    )
  }
  if (payload === undefined) throw new ApiError('internal', response.status)
  return payload as T
}

const eventPath = (id: string) => `/events/${encodeURIComponent(id)}`

export function createEvent(input: NewEventInput): Promise<CreatedEvent> {
  return request('POST', '/events', { body: input })
}

export function getEvent(id: string, credentials: RequestCredentials = {}): Promise<EventData> {
  return request('GET', eventPath(id), credentials)
}

export function joinEvent(id: string, name: string): Promise<JoinedEvent> {
  return request('POST', `${eventPath(id)}/participants`, { body: { name } })
}

export function changeAbsences(id: string, token: string, change: AbsenceChange): Promise<EventData> {
  return request('PUT', `${eventPath(id)}/absences`, { participant: token, body: change })
}

export function closeEvent(id: string, key: string): Promise<EventData> {
  return request('POST', `${eventPath(id)}/close`, { organiser: key })
}

export function reopenEvent(id: string, key: string): Promise<EventData> {
  return request('POST', `${eventPath(id)}/reopen`, { organiser: key })
}

export function removeParticipant(id: string, key: string, participantId: string): Promise<EventData> {
  return request('DELETE', `${eventPath(id)}/participants/${encodeURIComponent(participantId)}`, {
    organiser: key,
  })
}

/** The address of an event's live stream; it takes no credentials. */
export function streamUrl(id: string): string {
  return `${BASE}${eventPath(id)}/stream`
}

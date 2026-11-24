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

/** The code for an error answer that carries no usable JSON body. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'invalid_request'
    case 401:
      return 'unauthorized'
    case 404:
      return 'not_found'
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

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.participant) headers.Authorization = `Bearer ${options.participant}`
  if (options.organiser) headers['X-Organiser-Key'] = options.organiser
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(BASE + path, init)
  } catch {
    throw new ApiError('network', 0)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: unknown; message?: unknown } } | undefined)?.error
    const code = isErrorCode(error?.code) && error.code !== 'network' ? error.code : codeForStatus(response.status)
    throw new ApiError(code, response.status, typeof error?.message === 'string' ? error.message : undefined)
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

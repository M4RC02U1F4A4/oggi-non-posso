// The API contract, as the design document states it. Nothing here is
// derived by the frontend: these are the shapes the backend sends.

export type Slot = 'morning' | 'lunch' | 'afternoon' | 'dinner' | 'after_dinner'

export interface Pair {
  date: string
  slot: Slot
}

export interface EventDay {
  date: string
  slots: Slot[]
}

export interface Participant {
  id: string
  name: string
  organiser: boolean
  /** Only dates with at least one slot. */
  absences: Record<string, Slot[]>
}

export interface Alternative {
  date: string
  slots: Slot[]
  /** Participant ids. */
  missing: string[]
}

export type EventStatus = 'open' | 'closed'

export interface EventData {
  id: string
  title: string
  status: EventStatus
  version: number
  /** Union of the days' slots, canonical order. */
  slots: Slot[]
  /** Ascending by date. */
  days: EventDay[]
  /** In joining order. */
  participants: Participant[]
  /** The caller's participant id, or null. */
  me: string | null
  can_manage: boolean
  created_at: string
  closed_at: string | null
  /** Null while open. */
  alternatives: Alternative[] | null
}

export interface NewEventInput {
  title: string
  organiser_name: string
  days: EventDay[]
}

export interface CreatedEvent {
  event: EventData
  participant_token: string
  organiser_key: string
}

export interface JoinedEvent {
  event: EventData
  participant_token: string
}

export interface AbsenceChange {
  set: Pair[]
  clear: Pair[]
}

export interface StreamUpdate {
  version: number
  kind: 'absences' | 'participants' | 'status'
  by: string | null
}

/** The backend's error codes, plus `network` for a request that got no answer. */
export const ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'not_found',
  'event_closed',
  'name_taken',
  'too_many_participants',
  'cannot_remove_organiser',
  'payload_too_large',
  'validation_failed',
  'rate_limited',
  'internal',
  'network',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode, status: number, message?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** The code of anything thrown by the client; `internal` for the unexpected. */
export function errorCode(err: unknown): ErrorCode {
  return err instanceof ApiError ? err.code : 'internal'
}

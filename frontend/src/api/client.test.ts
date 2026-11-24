import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changeAbsences,
  closeEvent,
  createEvent,
  getEvent,
  joinEvent,
  removeParticipant,
  reopenEvent,
} from './client'
import { ORGANISER_KEY } from '../test/fixture'
import { ApiError } from './types'

const fetchMock = vi.fn<typeof fetch>()

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function lastCall(): { url: string; init: RequestInit; headers: Record<string, string> } {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('fetch was not called')
  const init = (call[1] ?? {}) as RequestInit
  return { url: String(call[0]), init, headers: init.headers as Record<string, string> }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('credentials', () => {
  it('sends no credential when it has none', async () => {
    fetchMock.mockResolvedValue(answer(200, { id: 'abc' }))
    await getEvent('abc')
    const { url, init, headers } = lastCall()
    expect(url).toBe('/api/events/abc')
    expect(init.method).toBe('GET')
    expect(headers.Authorization).toBeUndefined()
    expect(headers['X-Organiser-Key']).toBeUndefined()
  })

  it('reads an event with both credentials in their headers', async () => {
    fetchMock.mockResolvedValue(answer(200, { id: 'abc' }))
    await getEvent('abc', { participant: 'p_token', organiser: ORGANISER_KEY })
    const { headers } = lastCall()
    expect(headers.Authorization).toBe('Bearer p_token')
    expect(headers['X-Organiser-Key']).toBe(ORGANISER_KEY)
  })

  it('marks absences as the participant', async () => {
    fetchMock.mockResolvedValue(answer(200, { id: 'abc' }))
    const change = { set: [{ date: '2026-12-11', slot: 'dinner' as const }], clear: [] }
    await changeAbsences('abc', 'p_token', change)
    const { url, init, headers } = lastCall()
    expect(url).toBe('/api/events/abc/absences')
    expect(init.method).toBe('PUT')
    expect(headers.Authorization).toBe('Bearer p_token')
    expect(headers['X-Organiser-Key']).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual(change)
  })

  it('closes, reopens and removes as the organiser', async () => {
    fetchMock.mockImplementation(async () => answer(200, { id: 'abc' }))

    await closeEvent('abc', ORGANISER_KEY)
    expect(lastCall().url).toBe('/api/events/abc/close')
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().headers['X-Organiser-Key']).toBe(ORGANISER_KEY)
    expect(lastCall().headers.Authorization).toBeUndefined()

    await reopenEvent('abc', ORGANISER_KEY)
    expect(lastCall().url).toBe('/api/events/abc/reopen')
    expect(lastCall().headers['X-Organiser-Key']).toBe(ORGANISER_KEY)

    await removeParticipant('abc', ORGANISER_KEY, 'pid')
    expect(lastCall().url).toBe('/api/events/abc/participants/pid')
    expect(lastCall().init.method).toBe('DELETE')
    expect(lastCall().headers['X-Organiser-Key']).toBe(ORGANISER_KEY)
  })

  it('creates and joins without credentials', async () => {
    fetchMock.mockImplementation(async () => answer(201, { event: { id: 'abc' }, participant_token: 'p_x' }))

    const input = { title: 'Cena di dicembre', organiser_name: 'Giulia', days: [] }
    await createEvent(input)
    expect(lastCall().url).toBe('/api/events')
    expect(JSON.parse(String(lastCall().init.body))).toEqual(input)
    expect(lastCall().headers.Authorization).toBeUndefined()

    const joined = await joinEvent('abc', 'Luca')
    expect(lastCall().url).toBe('/api/events/abc/participants')
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ name: 'Luca' })
    expect(joined.participant_token).toBe('p_x')
  })
})

describe('errors', () => {
  it('turns a JSON error into an ApiError with its code', async () => {
    fetchMock.mockResolvedValue(answer(409, { error: { code: 'name_taken', message: 'name already in use' } }))
    const failure = await joinEvent('abc', 'Giulia').catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({ code: 'name_taken', status: 409 })
  })

  it('falls back on the status when the body is not the API’s', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
    await expect(getEvent('abc')).rejects.toMatchObject({ code: 'internal', status: 502 })

    fetchMock.mockResolvedValue(new Response('', { status: 404 }))
    await expect(getEvent('abc')).rejects.toMatchObject({ code: 'not_found', status: 404 })

    fetchMock.mockResolvedValue(answer(429, { error: { code: 'something_new' } }))
    await expect(getEvent('abc')).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
  })

  it('turns a network failure into the code "network"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const failure = await getEvent('abc').catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({ code: 'network', status: 0 })
  })
})

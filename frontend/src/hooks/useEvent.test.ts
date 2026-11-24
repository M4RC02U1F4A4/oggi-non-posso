import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../api/client'
import { ApiError, type EventData } from '../api/types'
import * as credentials from '../lib/credentials'
import { isAbsent } from '../lib/grid'
import { FakeEventSource, installFakeEventSource, setVisibility } from '../test/eventSource'
import { EVENT_ID, ORGANISER_KEY, OTHER_KEY, closedFixtureEvent, fixtureEvent, idOf } from '../test/fixture'
import { useEvent } from './useEvent'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof client>()),
  getEvent: vi.fn(),
  joinEvent: vi.fn(),
  changeAbsences: vi.fn(),
  closeEvent: vi.fn(),
  reopenEvent: vi.fn(),
  removeParticipant: vi.fn(),
}))

const getEvent = vi.mocked(client.getEvent)
const joinEvent = vi.mocked(client.joinEvent)
const changeAbsences = vi.mocked(client.changeAbsences)
const closeEvent = vi.mocked(client.closeEvent)
const removeParticipant = vi.mocked(client.removeParticipant)

const ID = EVENT_ID
const DINNER = { date: '2026-12-12', slot: 'dinner' } as const

/** A promise the test settles when it wants to. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets pending promises and zero-delay timers run. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))

const annaAt = (event: EventData | undefined, pair: { date: string; slot: 'dinner' | 'lunch' }) => {
  const anna = event?.participants.find((p) => p.id === idOf('Anna'))
  if (!anna) throw new Error('Anna is not in the event')
  return isAbsent(anna, pair.date, pair.slot)
}

/** The fixture as Anna sees it, with one more mark and one more version. */
function marked(version: number, overrides: Partial<EventData> = {}): EventData {
  const event = fixtureEvent('Anna', { version, ...overrides })
  return {
    ...event,
    participants: event.participants.map((p) =>
      p.id === idOf('Anna')
        ? { ...p, absences: { ...p.absences, '2026-12-12': ['morning', 'lunch', 'dinner'] } }
        : p,
    ),
  }
}

async function mount() {
  const hook = renderHook(() => useEvent(ID))
  await settle()
  return hook
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  window.localStorage.clear()
  installFakeEventSource()
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('loading', () => {
  it('fetches the event with the stored credentials and opens the stream', async () => {
    credentials.saveParticipant(ID, 'p_anna')
    credentials.saveOrganiser(ID, ORGANISER_KEY)
    getEvent.mockResolvedValue(fixtureEvent('Anna'))

    const { result } = renderHook(() => useEvent(ID))
    expect(result.current.state).toBe('loading')
    expect(FakeEventSource.instances).toHaveLength(0)
    await settle()

    expect(getEvent).toHaveBeenCalledWith(ID, { participant: 'p_anna', organiser: ORGANISER_KEY })
    expect(result.current.state).toBe('ready')
    expect(result.current.event?.me).toBe(idOf('Anna'))
    expect(result.current.saveState).toBe('saved')
    expect(FakeEventSource.open()).toHaveLength(1)
  })

  it('says when the event does not exist, and does not listen to it', async () => {
    getEvent.mockRejectedValue(new ApiError('not_found', 404))
    const { result } = await mount()
    expect(result.current.state).toBe('not_found')
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('says when the first load fails, and recovers on refresh', async () => {
    getEvent.mockRejectedValueOnce(new ApiError('network', 0))
    const { result } = await mount()
    expect(result.current.state).toBe('error')
    expect(result.current.loadError).toBe('network')

    getEvent.mockResolvedValue(fixtureEvent())
    act(() => result.current.refresh())
    await settle()
    expect(result.current.state).toBe('ready')
    expect(result.current.loadError).toBeNull()
  })

  it('keeps the page when a later fetch fails', async () => {
    getEvent.mockResolvedValueOnce(fixtureEvent())
    const { result } = await mount()
    getEvent.mockRejectedValue(new ApiError('network', 0))
    act(() => result.current.refresh())
    await settle()
    expect(result.current.state).toBe('ready')
    expect(result.current.event?.version).toBe(40)
  })
})

describe('live updates', () => {
  it('refetches once for a newer version and not at all for an older one', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { version: 40 }))
    await mount()
    expect(getEvent).toHaveBeenCalledTimes(1)

    act(() => FakeEventSource.latest().emit({ version: 40, kind: 'status', by: null }))
    act(() => FakeEventSource.latest().emit({ version: 39, kind: 'absences', by: idOf('Luca') }))
    await settle()
    expect(getEvent).toHaveBeenCalledTimes(1)

    getEvent.mockResolvedValue(fixtureEvent(null, { version: 41 }))
    act(() => FakeEventSource.latest().emit({ version: 41, kind: 'absences', by: idOf('Luca') }))
    await settle()
    expect(getEvent).toHaveBeenCalledTimes(2)

    act(() => FakeEventSource.latest().emit({ version: 41, kind: 'absences', by: idOf('Luca') }))
    await settle()
    expect(getEvent).toHaveBeenCalledTimes(2)
  })

  it('does not go back to an older answer', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { version: 40 }))
    const { result } = await mount()
    getEvent.mockResolvedValue(fixtureEvent(null, { version: 38, title: 'stale' }))
    act(() => result.current.refresh())
    await settle()
    expect(result.current.event?.version).toBe(40)
  })

  it('shows who is marking for 8 seconds after their last change', async () => {
    getEvent.mockResolvedValue(fixtureEvent('Anna'))
    const { result } = await mount()
    expect(result.current.marking.size).toBe(0)

    act(() => FakeEventSource.latest().emit({ version: 40, kind: 'absences', by: idOf('Paolo') }))
    expect([...result.current.marking]).toEqual([idOf('Paolo')])

    await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)))
    act(() => FakeEventSource.latest().emit({ version: 40, kind: 'absences', by: idOf('Paolo') }))
    await act(async () => void (await vi.advanceTimersByTimeAsync(7_999)))
    expect(result.current.marking.has(idOf('Paolo'))).toBe(true)

    await act(async () => void (await vi.advanceTimersByTimeAsync(1)))
    expect(result.current.marking.size).toBe(0)
  })

  it('does not count joining or closing as marking', async () => {
    getEvent.mockResolvedValue(fixtureEvent('Anna'))
    const { result } = await mount()
    act(() => FakeEventSource.latest().emit({ version: 40, kind: 'participants', by: idOf('Paolo') }))
    act(() => FakeEventSource.latest().emit({ version: 40, kind: 'status', by: null }))
    expect(result.current.marking.size).toBe(0)
  })

  it('reads the event once when the stream fails, and stops when the event is gone', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    const { result } = await mount()
    expect(getEvent).toHaveBeenCalledTimes(1)

    act(() => FakeEventSource.latest().fail())
    await settle()
    expect(getEvent).toHaveBeenCalledTimes(2)
    expect(result.current.state).toBe('ready')

    // The event was deleted: its stream answers 404, and so does the event.
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_000)))
    getEvent.mockRejectedValue(new ApiError('not_found', 404))
    act(() => FakeEventSource.latest().fail())
    await settle()
    expect(result.current.state).toBe('not_found')

    await act(async () => void (await vi.advanceTimersByTimeAsync(120_000)))
    expect(FakeEventSource.open()).toHaveLength(0)
    expect(getEvent).toHaveBeenCalledTimes(3)
  })

  it('keeps the page when something in between answers 404 without the API’s body', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    const { result } = await mount()
    // What the client makes of a bare 404: not "not found".
    getEvent.mockRejectedValue(new ApiError('internal', 404))
    act(() => result.current.refresh())
    await settle()
    expect(result.current.state).toBe('ready')
    expect(FakeEventSource.open()).toHaveLength(1)
  })

  it('refetches when the page becomes visible again', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    await mount()
    expect(getEvent).toHaveBeenCalledTimes(1)

    act(() => setVisibility('hidden'))
    await settle()
    expect(getEvent).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await settle()
    expect(getEvent).toHaveBeenCalledTimes(2)
    expect(FakeEventSource.open()).toHaveLength(1)
  })
})

describe('marking', () => {
  beforeEach(() => {
    credentials.saveParticipant(ID, 'p_anna')
    getEvent.mockResolvedValue(fixtureEvent('Anna'))
  })

  it('changes the cell at once and keeps it when the server agrees', async () => {
    const pending = deferred<EventData>()
    changeAbsences.mockReturnValue(pending.promise)
    const { result } = await mount()
    expect(annaAt(result.current.event, DINNER)).toBe(false)

    act(() => result.current.toggle([DINNER]))
    expect(annaAt(result.current.event, DINNER)).toBe(true)
    expect(result.current.saveState).toBe('saving')
    expect(changeAbsences).toHaveBeenCalledWith(ID, 'p_anna', { set: [DINNER], clear: [] })

    pending.resolve(marked(41))
    await settle()
    expect(annaAt(result.current.event, DINNER)).toBe(true)
    expect(result.current.event?.version).toBe(41)
    expect(result.current.saveState).toBe('saved')
  })

  it('restores the cell and says so when the request fails', async () => {
    const pending = deferred<EventData>()
    changeAbsences.mockReturnValue(pending.promise)
    const { result } = await mount()

    act(() => result.current.toggle([DINNER]))
    expect(annaAt(result.current.event, DINNER)).toBe(true)

    pending.reject(new ApiError('network', 0))
    await settle()
    expect(annaAt(result.current.event, DINNER)).toBe(false)
    expect(result.current.saveState).toBe('failed')
    expect(result.current.saveError).toBe('network')

    changeAbsences.mockResolvedValue(marked(41))
    act(() => result.current.toggle([DINNER]))
    expect(result.current.saveError).toBeNull()
    await settle()
    expect(result.current.saveState).toBe('saved')
  })

  it('shows what the server really has when the outcome of a request is unknown', async () => {
    // The mark arrived, its answer did not.
    changeAbsences.mockRejectedValue(new ApiError('network', 0))
    const { result } = await mount()
    getEvent.mockResolvedValue(marked(41))

    act(() => result.current.toggle([DINNER]))
    await settle()

    expect(getEvent).toHaveBeenCalledTimes(2)
    expect(result.current.saveError).toBe('network')
    expect(result.current.event?.version).toBe(41)
    expect(annaAt(result.current.event, DINNER)).toBe(true)
  })

  it('does not read again for a refusal that leaves no doubt', async () => {
    changeAbsences.mockRejectedValue(new ApiError('validation_failed', 422))
    const { result } = await mount()

    act(() => result.current.toggle([DINNER]))
    await settle()
    expect(result.current.saveError).toBe('validation_failed')
    expect(getEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps the event and the token when a mark meets a 404 that is not the API’s', async () => {
    changeAbsences.mockRejectedValue(new ApiError('internal', 404))
    const { result } = await mount()

    act(() => result.current.toggle([DINNER]))
    await settle()
    expect(result.current.state).toBe('ready')
    expect(result.current.saveError).toBe('internal')
    expect(credentials.load(ID).participant).toBe('p_anna')
  })

  it('sends the taps made while a request is in flight as one request', async () => {
    const first = deferred<EventData>()
    changeAbsences.mockReturnValueOnce(first.promise)
    const { result } = await mount()

    act(() => result.current.toggle([DINNER]))
    act(() => result.current.toggle([{ date: '2026-12-12', slot: 'afternoon' }]))
    act(() => result.current.toggle([{ date: '2026-12-12', slot: 'afternoon' }]))
    act(() => result.current.toggle([{ date: '2026-12-12', slot: 'lunch' }]))
    expect(changeAbsences).toHaveBeenCalledTimes(1)
    expect(annaAt(result.current.event, { date: '2026-12-12', slot: 'lunch' })).toBe(false)

    changeAbsences.mockResolvedValue(marked(42))
    first.resolve(marked(41))
    await settle()
    expect(changeAbsences).toHaveBeenCalledTimes(2)
    expect(changeAbsences).toHaveBeenLastCalledWith(ID, 'p_anna', {
      set: [],
      clear: [
        { date: '2026-12-12', slot: 'afternoon' },
        { date: '2026-12-12', slot: 'lunch' },
      ],
    })
    expect(result.current.saveState).toBe('saved')
  })

  it('does not refetch for its own change while the request is in flight', async () => {
    const pending = deferred<EventData>()
    changeAbsences.mockReturnValue(pending.promise)
    const { result } = await mount()

    act(() => result.current.toggle([DINNER]))
    act(() => FakeEventSource.latest().emit({ version: 41, kind: 'absences', by: idOf('Anna') }))
    pending.resolve(marked(41))
    await settle()
    expect(getEvent).toHaveBeenCalledTimes(1)
  })

  it('moves on to the result when the event was closed meanwhile, without an error', async () => {
    changeAbsences.mockRejectedValue(new ApiError('event_closed', 409))
    const { result } = await mount()
    getEvent.mockResolvedValue(closedFixtureEvent('Anna'))

    act(() => result.current.toggle([DINNER]))
    await settle()

    expect(getEvent).toHaveBeenCalledTimes(2)
    expect(result.current.event?.status).toBe('closed')
    expect(annaAt(result.current.event, DINNER)).toBe(false)
    expect(result.current.saveError).toBeNull()
    expect(result.current.saveState).toBe('saved')
  })

  it('forgets a rejected token', async () => {
    changeAbsences.mockRejectedValue(new ApiError('unauthorized', 401))
    const { result } = await mount()
    getEvent.mockResolvedValue(fixtureEvent(null, { version: 41 }))

    act(() => result.current.toggle([DINNER]))
    await settle()

    expect(credentials.load(ID).participant).toBeUndefined()
    expect(getEvent).toHaveBeenLastCalledWith(ID, {})
    expect(result.current.event?.me).toBeNull()
    expect(result.current.dropped).toBe(true)
    expect(result.current.saveError).toBeNull()
  })

  it('forgets the token when a refetch no longer knows this participant', async () => {
    const { result } = await mount()
    const withoutAnna = fixtureEvent(null, { version: 41 })
    getEvent.mockResolvedValue({
      ...withoutAnna,
      participants: withoutAnna.participants.filter((p) => p.id !== idOf('Anna')),
    })

    act(() => FakeEventSource.latest().emit({ version: 41, kind: 'participants', by: null }))
    await settle()

    expect(credentials.load(ID).participant).toBeUndefined()
    expect(result.current.event?.me).toBeNull()
    expect(result.current.dropped).toBe(true)
  })

  it('ignores a tap from a visitor', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    const { result } = await mount()
    act(() => result.current.toggle([DINNER]))
    expect(changeAbsences).not.toHaveBeenCalled()
    expect(result.current.saveState).toBe('saved')
  })

  it('keeps knowing it organises after marking', async () => {
    credentials.saveOrganiser(ID, ORGANISER_KEY)
    getEvent.mockResolvedValue(fixtureEvent('Anna', { can_manage: true }))
    changeAbsences.mockResolvedValue(marked(41, { can_manage: false }))
    const { result } = await mount()

    act(() => result.current.toggle([DINNER]))
    await settle()
    expect(result.current.event?.version).toBe(41)
    expect(result.current.event?.can_manage).toBe(true)
  })
})

describe('joining', () => {
  it('stores the token and becomes a participant', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    const { result } = await mount()
    const joined = fixtureEvent('Anna', { version: 41 })
    joinEvent.mockResolvedValue({ event: { ...joined, me: null }, participant_token: 'p_new' })

    await act(() => result.current.join('Paolo'))

    expect(joinEvent).toHaveBeenCalledWith(ID, 'Paolo')
    expect(credentials.load(ID).participant).toBe('p_new')
    expect(result.current.event?.me).toBe(idOf('Paolo'))
  })

  it('stays a participant when the browser has no storage to keep the token in', async () => {
    const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    try {
      getEvent.mockResolvedValue(fixtureEvent())
      const { result } = await mount()
      joinEvent.mockResolvedValue({ event: fixtureEvent('Anna', { version: 41 }), participant_token: 'p_new' })
      getEvent.mockResolvedValue(fixtureEvent('Anna', { version: 41 }))

      await act(() => result.current.join('Anna'))
      expect(result.current.event?.me).toBe(idOf('Anna'))

      // A later read still goes out as that participant, and so does a mark.
      act(() => result.current.refresh())
      await settle()
      expect(getEvent).toHaveBeenLastCalledWith(ID, { participant: 'p_new' })
      expect(result.current.event?.me).toBe(idOf('Anna'))
      expect(result.current.dropped).toBe(false)

      changeAbsences.mockResolvedValue(marked(42))
      act(() => result.current.toggle([DINNER]))
      await settle()
      expect(changeAbsences).toHaveBeenCalledWith(ID, 'p_new', { set: [DINNER], clear: [] })
    } finally {
      storage.mockRestore()
      credentials.forgetParticipant(ID)
    }
  })

  it('hands the error to the form', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    const { result } = await mount()
    joinEvent.mockRejectedValue(new ApiError('name_taken', 409))

    await expect(act(() => result.current.join('Giulia'))).rejects.toMatchObject({ code: 'name_taken' })
    expect(credentials.load(ID)).toEqual({})
  })

  it('moves on to the result when the event was closed meanwhile', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    const { result } = await mount()
    joinEvent.mockRejectedValue(new ApiError('event_closed', 409))
    getEvent.mockResolvedValue(closedFixtureEvent())

    await act(() => result.current.join('Sara'))
    expect(result.current.event?.status).toBe('closed')
  })
})

describe('organising', () => {
  beforeEach(() => {
    credentials.saveParticipant(ID, 'p_giulia')
    credentials.saveOrganiser(ID, ORGANISER_KEY)
    getEvent.mockResolvedValue(fixtureEvent('Giulia', { can_manage: true }))
  })

  it('closes with the organiser key and stays the same participant', async () => {
    const { result } = await mount()
    closeEvent.mockResolvedValue(closedFixtureEvent(null, { can_manage: true }))

    await act(() => result.current.close())

    expect(closeEvent).toHaveBeenCalledWith(ID, ORGANISER_KEY)
    expect(result.current.event?.status).toBe('closed')
    expect(result.current.event?.me).toBe(idOf('Giulia'))
    expect(result.current.event?.can_manage).toBe(true)
  })

  it('removes a participant', async () => {
    const { result } = await mount()
    const after = fixtureEvent(null, { version: 41, can_manage: true })
    removeParticipant.mockResolvedValue({
      ...after,
      participants: after.participants.filter((p) => p.id !== idOf('Luca')),
    })

    await act(() => result.current.remove(idOf('Luca')))

    expect(removeParticipant).toHaveBeenCalledWith(ID, ORGANISER_KEY, idOf('Luca'))
    expect(result.current.event?.participants.map((p) => p.name)).toEqual(['Giulia', 'Anna', 'Marta', 'Paolo'])
    expect(result.current.event?.me).toBe(idOf('Giulia'))
    expect(credentials.load(ID).participant).toBe('p_giulia')
  })

  it('refuses without a key, and passes the server’s refusal on', async () => {
    const { result } = await mount()
    closeEvent.mockRejectedValue(new ApiError('unauthorized', 401))
    await expect(act(() => result.current.close())).rejects.toMatchObject({ code: 'unauthorized' })

    credentials.forgetParticipant(ID)
    window.localStorage.clear()
    closeEvent.mockClear()
    await expect(act(() => result.current.close())).rejects.toMatchObject({ code: 'unauthorized' })
    expect(closeEvent).not.toHaveBeenCalled()
  })
})

describe('organiser link', () => {
  const CANDIDATE = 'cccccccc-dddd-4eee-8fff-000000000000'

  async function mountWith(candidate: string) {
    const hook = renderHook(() => useEvent(ID, candidate))
    await settle()
    return hook
  }

  it('stores the key once the server says it manages the event', async () => {
    credentials.saveParticipant(ID, 'p_giulia')
    getEvent.mockResolvedValue(fixtureEvent('Giulia', { can_manage: true }))

    const { result } = await mountWith(CANDIDATE)

    expect(getEvent).toHaveBeenCalledTimes(1)
    expect(getEvent).toHaveBeenCalledWith(ID, { participant: 'p_giulia', organiser: CANDIDATE })
    expect(credentials.load(ID)).toEqual({ participant: 'p_giulia', organiser: CANDIDATE })
    expect(result.current.event?.can_manage).toBe(true)
    expect(result.current.organiserLinkRejected).toBe(false)
  })

  it('does not store a key the server does not recognise', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: false }))

    const { result } = await mountWith(CANDIDATE)

    expect(credentials.load(ID)).toEqual({})
    expect(result.current.state).toBe('ready')
    expect(result.current.event?.can_manage).toBe(false)
    expect(result.current.organiserLinkRejected).toBe(true)
  })

  it('keeps a stored key that works when the link carries one that does not', async () => {
    credentials.saveOrganiser(ID, OTHER_KEY)
    getEvent.mockImplementation(async (_id, sent) =>
      fixtureEvent(null, { can_manage: sent?.organiser === OTHER_KEY }),
    )

    const { result } = await mountWith(CANDIDATE)

    expect(getEvent).toHaveBeenCalledTimes(2)
    expect(getEvent).toHaveBeenNthCalledWith(1, ID, { organiser: CANDIDATE })
    expect(getEvent).toHaveBeenNthCalledWith(2, ID, { organiser: OTHER_KEY })
    expect(credentials.load(ID)).toEqual({ organiser: OTHER_KEY })
    expect(result.current.event?.can_manage).toBe(true)
    expect(result.current.organiserLinkRejected).toBe(true)
  })

  it('replaces a stored key with another that works too', async () => {
    credentials.saveOrganiser(ID, OTHER_KEY)
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))

    const { result } = await mountWith(CANDIDATE)

    expect(credentials.load(ID)).toEqual({ organiser: CANDIDATE })
    expect(result.current.organiserLinkRejected).toBe(false)
  })

  it('keeps the stored key when the request fails, and asks again on the next try', async () => {
    credentials.saveOrganiser(ID, OTHER_KEY)
    getEvent.mockRejectedValueOnce(new ApiError('network', 0))

    const { result } = await mountWith(CANDIDATE)
    expect(result.current.state).toBe('error')
    expect(credentials.load(ID)).toEqual({ organiser: OTHER_KEY })
    expect(result.current.organiserLinkRejected).toBe(false)

    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))
    act(() => result.current.refresh())
    await settle()
    expect(getEvent).toHaveBeenLastCalledWith(ID, { organiser: CANDIDATE })
    expect(credentials.load(ID)).toEqual({ organiser: CANDIDATE })
  })

  it('asks about the candidate once, then reads with what is stored', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: false }))
    const { result } = await mountWith(CANDIDATE)

    act(() => result.current.refresh())
    await settle()
    expect(getEvent).toHaveBeenCalledTimes(2)
    expect(getEvent).toHaveBeenLastCalledWith(ID, {})
  })
})

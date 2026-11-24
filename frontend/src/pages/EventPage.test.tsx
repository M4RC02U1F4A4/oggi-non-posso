import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../api/client'
import { ApiError } from '../api/types'
import { App } from '../App'
import * as credentials from '../lib/credentials'
import { FakeEventSource, installFakeEventSource, setVisibility } from '../test/eventSource'
import { EVENT_ID, ORGANISER_KEY, OTHER_KEY, closedFixtureEvent, fixtureEvent } from '../test/fixture'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof client>()),
  getEvent: vi.fn(),
  joinEvent: vi.fn(),
}))

const getEvent = vi.mocked(client.getEvent)
const joinEvent = vi.mocked(client.joinEvent)

const INVALID = 'Questo link per organizzare non vale per questo evento.'
const NOT_FOUND = 'Questo evento non c’è'
const EVENT_PATH = `/e/${EVENT_ID}`

/** Shows where the router is, and offers a way back in the history. */
function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <button type="button" data-testid="probe" onClick={() => void navigate(-1)}>
      {location.pathname + location.search + location.hash}
    </button>
  )
}

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))
const address = () => screen.getByTestId('probe').textContent

/** Opens the app at an address, as following a link does. */
async function open(path: string, before: string[] = []) {
  render(
    <MemoryRouter initialEntries={[...before, path]}>
      <App />
      <Probe />
    </MemoryRouter>,
  )
  await settle()
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

describe('the share link', () => {
  it('opens the event', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    await open(EVENT_PATH)

    expect(getEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID, {})
    expect(address()).toBe(EVENT_PATH)
    expect(screen.queryByText(INVALID)).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Rimpatriata di dicembre')
  })

  it.each(['k7Qm2xVd9LpA', 'anything', ORGANISER_KEY.toUpperCase(), `${EVENT_ID}0`])(
    'answers "not found" without a request when the id is not a UUID: %s',
    async (id) => {
      await open(`/e/${id}`)
      expect(getEvent).not.toHaveBeenCalled()
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(NOT_FOUND)
    },
  )

  it('has nothing under an event but the organiser link', async () => {
    await open(`${EVENT_PATH}/something`)
    expect(getEvent).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Qui non c’è niente')
  })
})

describe('the organiser link', () => {
  it('stores a key the server accepts, and leaves the address of the event', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))
    await open(`${EVENT_PATH}/o/${ORGANISER_KEY}`)

    expect(getEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID, { organiser: ORGANISER_KEY })
    expect(credentials.load(EVENT_ID)).toEqual({ organiser: ORGANISER_KEY })
    expect(address()).toBe(EVENT_PATH)
    expect(screen.queryByText(INVALID)).toBeNull()
    expect(screen.getByRole('button', { name: 'Chiudi la votazione' })).toBeDefined()
  })

  it('does not leave the key in the history either', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))
    await open(`${EVENT_PATH}/o/${ORGANISER_KEY}`, ['/'])
    expect(address()).toBe(EVENT_PATH)

    fireEvent.click(screen.getByTestId('probe'))
    await settle()
    expect(address()).toBe('/')
  })

  it('does not let a key the server rejects replace the stored one, and says so', async () => {
    credentials.saveOrganiser(EVENT_ID, OTHER_KEY)
    getEvent.mockImplementation(async (_id, sent) => fixtureEvent(null, { can_manage: sent?.organiser === OTHER_KEY }))
    await open(`${EVENT_PATH}/o/${ORGANISER_KEY}`)

    expect(getEvent).toHaveBeenNthCalledWith(1, EVENT_ID, { organiser: ORGANISER_KEY })
    expect(getEvent).toHaveBeenNthCalledWith(2, EVENT_ID, { organiser: OTHER_KEY })
    expect(credentials.load(EVENT_ID)).toEqual({ organiser: OTHER_KEY })
    expect(address()).toBe(EVENT_PATH)
    expect(screen.getByText(INVALID)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Chiudi la votazione' })).toBeDefined()
  })

  it('stores nothing when the server rejects the key and none was stored', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: false }))
    await open(`${EVENT_PATH}/o/${ORGANISER_KEY}`)

    expect(credentials.load(EVENT_ID)).toEqual({})
    expect(address()).toBe(EVENT_PATH)
    expect(screen.getByText(INVALID)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Chiudi la votazione' })).toBeNull()
  })

  it.each(['anything', 'o_l2LAqg8HSphf5JRtEpomL5quhOig2zHq9KZ24zdtHT8', ORGANISER_KEY.toUpperCase(), `${ORGANISER_KEY}0`])(
    'drops a key that is not a UUID without asking the server about it: %s',
    async (key) => {
      credentials.saveOrganiser(EVENT_ID, OTHER_KEY)
      getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))
      await open(`${EVENT_PATH}/o/${key}`)

      expect(getEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID, { organiser: OTHER_KEY })
      expect(credentials.load(EVENT_ID)).toEqual({ organiser: OTHER_KEY })
      expect(address()).toBe(EVENT_PATH)
      expect(screen.getByText(INVALID)).toBeDefined()
    },
  )

  it('keeps the candidate for the next try when the request fails, with the address already clean', async () => {
    credentials.saveOrganiser(EVENT_ID, OTHER_KEY)
    getEvent.mockRejectedValueOnce(new ApiError('network', 0))
    await open(`${EVENT_PATH}/o/${ORGANISER_KEY}`)

    expect(address()).toBe(EVENT_PATH)
    expect(credentials.load(EVENT_ID)).toEqual({ organiser: OTHER_KEY })
    expect(screen.queryByText(INVALID)).toBeNull()

    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }))
    await settle()
    expect(getEvent).toHaveBeenLastCalledWith(EVENT_ID, { organiser: ORGANISER_KEY })
    expect(credentials.load(EVENT_ID)).toEqual({ organiser: ORGANISER_KEY })
    expect(address()).toBe(EVENT_PATH)
  })

  it('takes the key out of the address when something follows it', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))
    await open(`${EVENT_PATH}/o/${ORGANISER_KEY}/anything/else`)

    expect(address()).toBe(EVENT_PATH)
    expect(getEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID, { organiser: ORGANISER_KEY })
    expect(credentials.load(EVENT_ID)).toEqual({ organiser: ORGANISER_KEY })
  })

  it('cleans the address even when the id is not one, and asks nothing', async () => {
    await open(`/e/anything/o/${ORGANISER_KEY}`)
    expect(address()).toBe('/e/anything')
    expect(getEvent).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(NOT_FOUND)
  })
})

describe('where the focus goes', () => {
  const heading = () => screen.getByRole('heading', { level: 1 })

  it('to the title when the voting closes and when it opens again', async () => {
    credentials.saveParticipant(EVENT_ID, 'p_anna')
    getEvent.mockResolvedValue(fixtureEvent('Anna'))
    await open(EVENT_PATH)
    expect(document.activeElement).not.toBe(heading())

    getEvent.mockResolvedValue(closedFixtureEvent('Anna'))
    act(() => FakeEventSource.latest().emit({ version: 41, kind: 'status', by: null }))
    await settle()
    expect(heading().textContent).toBe('Ci siete tutti in tre momenti')
    expect(document.activeElement).toBe(heading())

    getEvent.mockResolvedValue(fixtureEvent('Anna', { version: 42 }))
    act(() => FakeEventSource.latest().emit({ version: 42, kind: 'status', by: null }))
    await settle()
    expect(heading().textContent).toBe('Rimpatriata di dicembre')
    expect(document.activeElement).toBe(heading())
  })

  it('to the title once the name is in', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    await open(EVENT_PATH)
    joinEvent.mockResolvedValue({ event: fixtureEvent('Paolo', { version: 41 }), participant_token: 'p_paolo' })

    fireEvent.change(screen.getByLabelText('Come ti chiami?'), { target: { value: 'Paolo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entra e segna quando non puoi' }))
    await settle()
    expect(joinEvent).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Come ti chiami?')).toBeNull()
    expect(document.activeElement).toBe(heading())
  })
})

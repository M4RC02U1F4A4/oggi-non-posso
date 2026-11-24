import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../api/client'
import * as credentials from '../lib/credentials'
import { installFakeEventSource, setVisibility } from '../test/eventSource'
import { fixtureEvent } from '../test/fixture'
import { EventPage } from './EventPage'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof client>()),
  getEvent: vi.fn(),
}))

const getEvent = vi.mocked(client.getEvent)

const ID = 'k7Qm2xVd9LpA'
const KEY = 'o_l2LAqg8HSphf5JRtEpomL5quhOig2zHq9KZ24zdtHT8'
const INVALID = 'Questo link per organizzare non vale per questo evento.'

/** Opens the event page at an address with the given fragment. */
async function open(hash: string) {
  window.history.replaceState(null, '', `/e/${ID}${hash}`)
  render(
    <MemoryRouter initialEntries={[`/e/${ID}`]}>
      <Routes>
        <Route path="/e/:id" element={<EventPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
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
  window.history.replaceState(null, '', '/')
})

describe('the organiser link', () => {
  it('stores a key the server accepts, and takes it out of the address', async () => {
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))
    await open(`#o=${KEY}`)

    expect(getEvent).toHaveBeenCalledWith(ID, { organiser: KEY })
    expect(credentials.load(ID)).toEqual({ organiser: KEY })
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe(`/e/${ID}`)
    expect(screen.queryByText(INVALID)).toBeNull()
  })

  it('does not let a key the server rejects replace the stored one, and says so', async () => {
    credentials.saveOrganiser(ID, 'o_stored')
    getEvent.mockImplementation(async (_id, sent) =>
      fixtureEvent(null, { can_manage: sent?.organiser === 'o_stored' }),
    )
    await open(`#o=${KEY}`)

    expect(credentials.load(ID)).toEqual({ organiser: 'o_stored' })
    expect(window.location.hash).toBe('')
    expect(screen.getByText(INVALID)).toBeDefined()
  })

  it('drops a malformed fragment without asking the server about it', async () => {
    credentials.saveOrganiser(ID, 'o_stored')
    getEvent.mockResolvedValue(fixtureEvent(null, { can_manage: true }))
    await open('#o=anything')

    expect(getEvent).toHaveBeenCalledTimes(1)
    expect(getEvent).toHaveBeenCalledWith(ID, { organiser: 'o_stored' })
    expect(credentials.load(ID)).toEqual({ organiser: 'o_stored' })
    expect(window.location.hash).toBe('')
    expect(screen.getByText(INVALID)).toBeDefined()
  })

  it('takes the fragment out of the address even when the request fails', async () => {
    getEvent.mockRejectedValue(new Error('offline'))
    await open(`#o=${KEY}`)

    expect(window.location.hash).toBe('')
    expect(credentials.load(ID)).toEqual({})
  })

  it('leaves an ordinary address alone', async () => {
    getEvent.mockResolvedValue(fixtureEvent())
    await open('')

    expect(getEvent).toHaveBeenCalledWith(ID, {})
    expect(screen.queryByText(INVALID)).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Rimpatriata di dicembre')
  })
})

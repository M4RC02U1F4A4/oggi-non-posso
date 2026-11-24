import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../api/client'
import { ApiError } from '../api/types'
import * as credentials from '../lib/credentials'
import { EVENT_ID, ORGANISER_KEY, fixtureEvent } from '../test/fixture'
import { CreatePage } from './CreatePage'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof client>()),
  createEvent: vi.fn(),
}))

const createEvent = vi.mocked(client.createEvent)

const ID = EVENT_ID
const KEY = ORGANISER_KEY

/** The history entry the page is on, as a reload would find it. */
let here: { pathname: string; state: unknown } | null = null

function Probe() {
  const location = useLocation()
  here = { pathname: location.pathname, state: location.state }
  return null
}

function open(entry: InitialEntry = '/') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <CreatePage />
      <Probe />
    </MemoryRouter>,
  )
}

function fill(title: string, name: string) {
  fireEvent.change(screen.getByLabelText('Cosa organizzi'), { target: { value: title } })
  fireEvent.change(screen.getByLabelText('Come ti chiami'), { target: { value: name } })
}

const pickDay = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }))
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Crea e prendi il link' }))

beforeEach(() => {
  // "Today" is the browser's local date: fix it, and only it.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 24, 16, 0))
  vi.resetAllMocks()
  window.localStorage.clear()
  createEvent.mockResolvedValue({
    event: fixtureEvent('Giulia', { can_manage: true }),
    participant_token: 'p_giulia',
    organiser_key: KEY,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('creating an event', () => {
  it('sends the title, the name and a list of slots per day', async () => {
    open()
    fill('  Rimpatriata di dicembre ', ' Giulia ')
    fireEvent.click(screen.getByRole('button', { name: 'Mese successivo' }))
    pickDay('sabato 12 dicembre 2026')
    pickDay('venerdì 11 dicembre 2026')

    // No after-dinner for anybody; no morning and no lunch on the Friday.
    const event = screen.getByRole('group', { name: 'Fasce della giornata' })
    fireEvent.click(within(event).getByRole('button', { name: /Dopocena/ }))
    fireEvent.click(screen.getByRole('button', { name: 'venerdì 11, mattina' }))
    fireEvent.click(screen.getByRole('button', { name: 'venerdì 11, pranzo' }))
    expect(screen.getByText('1 giorno cambiato')).toBeDefined()

    submit()
    await waitFor(() => expect(createEvent).toHaveBeenCalledOnce())
    expect(createEvent).toHaveBeenCalledWith({
      title: 'Rimpatriata di dicembre',
      organiser_name: 'Giulia',
      days: [
        { date: '2026-12-11', slots: ['afternoon', 'dinner'] },
        { date: '2026-12-12', slots: ['morning', 'lunch', 'afternoon', 'dinner'] },
      ],
    })
  })

  it('stores both credentials and shows the links to share', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    open()
    fill('Rimpatriata di dicembre', 'Giulia')
    pickDay('sabato 28 novembre 2026')
    submit()

    await screen.findByText('Fatto. Ora manda il link')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Fatto. Ora manda il link')
    expect(credentials.load(ID)).toEqual({ participant: 'p_giulia', organiser: KEY })

    const origin = window.location.origin
    fireEvent.click(screen.getByRole('button', { name: 'Copia il link' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${origin}/e/${ID}`))
    fireEvent.click(screen.getByRole('button', { name: 'Copia il link per organizzare' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${origin}/e/${ID}/o/${KEY}`))

    // The organiser link is copied whole and shown with its middle left out.
    expect(document.body.textContent).not.toContain(KEY)
    expect(document.body.textContent).toContain('/e/11111111…eeee')
    expect(screen.getByText(/ti riconosce già come Giulia/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Apri l’evento e segna le tue' }).getAttribute('href')).toBe(`/e/${ID}`)
  })

  it('offers to share only where the browser can', async () => {
    open()
    fill('Rimpatriata di dicembre', 'Giulia')
    pickDay('sabato 28 novembre 2026')
    submit()
    await screen.findByText('Fatto. Ora manda il link')
    expect(screen.queryByRole('button', { name: 'Condividi' })).toBeNull()
  })

  it('shares through the browser where it can', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    open()
    fill('Rimpatriata di dicembre', 'Giulia')
    pickDay('sabato 28 novembre 2026')
    submit()

    fireEvent.click(await screen.findByRole('button', { name: 'Condividi' }))
    expect(share).toHaveBeenCalledWith({
      title: 'Rimpatriata di dicembre',
      text: 'Rimpatriata di dicembre: segna quando non puoi',
      url: `${window.location.origin}/e/${ID}`,
    })
  })
})

describe('after creating', () => {
  async function create() {
    open()
    fill('Rimpatriata di dicembre', 'Giulia')
    pickDay('sabato 28 novembre 2026')
    submit()
    await screen.findByText('Fatto. Ora manda il link')
  }

  it('keeps the screen in the history, without the organiser key', async () => {
    await create()
    expect(here?.pathname).toBe('/')
    expect(JSON.stringify(here?.state)).toContain(ID)
    expect(JSON.stringify(here?.state)).not.toContain(KEY)
  })

  it('shows the same screen after a reload', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await create()
    const entry = { pathname: '/', state: here?.state }
    cleanup()

    open(entry)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Fatto. Ora manda il link')
    expect(screen.getByText('Rimpatriata di dicembre')).toBeDefined()
    expect(screen.getByText(/ti riconosce già come Giulia/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Copia il link per organizzare' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/e/${ID}/o/${KEY}`))
  })

  it('shows the form at a fresh visit, and when the key is no longer here', async () => {
    await create()
    const entry = { pathname: '/', state: here?.state }
    cleanup()

    open()
    expect(screen.getByRole('button', { name: 'Crea e prendi il link' })).toBeDefined()
    cleanup()

    window.localStorage.clear()
    open(entry)
    expect(screen.getByRole('button', { name: 'Crea e prendi il link' })).toBeDefined()
  })
})

describe('what can go wrong', () => {
  it('says how long to wait when the server says so', async () => {
    createEvent.mockRejectedValue(new ApiError('rate_limited', 429, undefined, 1500))
    open()
    fill('Rimpatriata di dicembre', 'Giulia')
    pickDay('sabato 28 novembre 2026')
    submit()
    await waitFor(() => expect(screen.getByText('Troppe richieste: riprova tra 25 minuti.')).toBeDefined())
  })

  it('asks for what is missing, next to its field, without calling the server', () => {
    open()
    submit()
    expect(screen.getByText('Scrivi cosa organizzi.')).toBeDefined()
    expect(screen.getByText('Scrivi come ti chiami.')).toBeDefined()
    expect(screen.getByText('Scegli almeno un giorno dal calendario.')).toBeDefined()
    expect(screen.getByLabelText('Cosa organizzi').getAttribute('aria-invalid')).toBe('true')
    expect(createEvent).not.toHaveBeenCalled()
  })

  it('counts characters, not bytes: 30 accented letters are a name, 31 are not', async () => {
    open()
    fill('è'.repeat(81), 'è'.repeat(31))
    pickDay('sabato 28 novembre 2026')
    submit()
    expect(screen.getByText('Troppo lungo: al massimo 80 caratteri.')).toBeDefined()
    expect(screen.getByText('Troppo lungo: al massimo 30 caratteri.')).toBeDefined()
    expect(createEvent).not.toHaveBeenCalled()

    fill('è'.repeat(80), 'è'.repeat(30))
    submit()
    await waitFor(() => expect(createEvent).toHaveBeenCalledOnce())
  })

  it.each([
    ['rate_limited', 429, 'Troppe richieste: riprova più tardi.'],
    ['network', 0, 'Non c’è collegamento. Controlla la connessione e riprova.'],
    ['validation_failed', 422, 'C’è qualcosa che non va in quello che hai scritto. Controlla e riprova.'],
  ] as const)('says in Italian what the server answered: %s', async (code, status, text) => {
    createEvent.mockRejectedValue(new ApiError(code, status))
    open()
    fill('Rimpatriata di dicembre', 'Giulia')
    pickDay('sabato 28 novembre 2026')
    submit()

    await waitFor(() => expect(screen.getByText(text)).toBeDefined())
    expect(credentials.load(ID)).toEqual({})
    // Still on the form, ready for another try.
    expect(screen.getByRole('button', { name: 'Crea e prendi il link' })).toHaveProperty('disabled', false)
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/types'
import * as credentials from '../lib/credentials'
import { EVENT_ID, ORGANISER_KEY, closedFixtureEvent, fixtureEvent } from '../test/fixture'
import { OrganiserPanel } from './OrganiserPanel'

const KEY = ORGANISER_KEY

beforeEach(() => {
  window.localStorage.clear()
  credentials.saveOrganiser(EVENT_ID, KEY)
})

describe('OrganiserPanel', () => {
  it('closes the voting only after a confirmation', async () => {
    const onClose = vi.fn().mockResolvedValue(undefined)
    render(<OrganiserPanel event={fixtureEvent('Giulia', { can_manage: true })} onClose={onClose} onReopen={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Chiudi la votazione' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Chiudere la votazione adesso?')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Chiudi la votazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sì, chiudi' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('reopens a closed voting at once', async () => {
    const onReopen = vi.fn().mockResolvedValue(undefined)
    render(<OrganiserPanel event={closedFixtureEvent('Giulia', { can_manage: true })} onClose={vi.fn()} onReopen={onReopen} />)
    expect(screen.queryByRole('button', { name: 'Chiudi la votazione' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Riapri la votazione' }))
    await waitFor(() => expect(onReopen).toHaveBeenCalledOnce())
  })

  it('says why when the server refuses', async () => {
    const onClose = vi.fn().mockRejectedValue(new ApiError('unauthorized', 401))
    render(<OrganiserPanel event={fixtureEvent('Giulia', { can_manage: true })} onClose={onClose} onReopen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi la votazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sì, chiudi' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Da questo browser non si può più fare. Ricarica la pagina.')
  })

  it('copies the share link and the organiser link, key included', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      render(<OrganiserPanel event={fixtureEvent('Giulia', { can_manage: true })} onClose={vi.fn()} onReopen={vi.fn()} />)
      const origin = window.location.origin

      fireEvent.click(screen.getByRole('button', { name: 'Copia il link per gli altri' }))
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${origin}/e/${EVENT_ID}`))

      fireEvent.click(screen.getByRole('button', { name: 'Copia il link per organizzare' }))
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${origin}/e/${EVENT_ID}/o/${KEY}`))
      // The key is copied, never shown.
      expect(document.body.textContent).not.toContain(KEY)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

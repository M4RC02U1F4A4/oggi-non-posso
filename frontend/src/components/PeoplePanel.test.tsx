import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/types'
import { fixtureEvent, idOf } from '../test/fixture'
import { PeoplePanel } from './PeoplePanel'

const nobody = new Set<string>()

describe('PeoplePanel', () => {
  it('lists who is in, with their slots and who is marking', () => {
    render(<PeoplePanel event={fixtureEvent('Anna')} marking={new Set([idOf('Paolo'), idOf('Anna')])} saveState="saved" />)
    expect(screen.getByRole('heading').textContent).toBe('Hanno segnato in 5')
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
    expect(rows).toEqual([
      'Giuliaorganizza7 fasce',
      'Luca11 fasce',
      'Annatu7 fasce, salvate',
      'Marta7 fasce',
      'Paolosta segnando',
    ])
    expect(screen.queryByRole('button')).toBeNull()
    expect([...document.querySelectorAll('.people__who bdi')].map((name) => name.textContent)).toEqual([
      'Giulia',
      'Luca',
      'Anna',
      'Marta',
      'Paolo',
    ])
  })

  it('tells the caller while their marks are on the way, and when they did not arrive', () => {
    const { rerender } = render(<PeoplePanel event={fixtureEvent('Anna')} marking={nobody} saveState="saving" />)
    expect(screen.getAllByRole('listitem')[2]?.textContent).toBe('Annatusalvo…')
    rerender(<PeoplePanel event={fixtureEvent('Anna')} marking={nobody} saveState="failed" />)
    expect(screen.getAllByRole('listitem')[2]?.textContent).toBe('Annatunon salvato')
  })

  it('lets the organiser remove anyone but the organiser, after a confirmation', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    render(<PeoplePanel event={fixtureEvent('Giulia')} marking={nobody} saveState="saved" onRemove={onRemove} />)

    expect(screen.queryByRole('button', { name: 'Togli Giulia' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Togli / })).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: 'Togli Luca' }))
    expect(onRemove).not.toHaveBeenCalled()
    const question = screen.getByRole('group', { name: 'Togli Luca' }).querySelector('p')
    expect(question?.textContent).toBe('Togliere Luca? Spariscono anche le sue fasce.')
    // The name is kept apart from the words around it, whatever its direction.
    expect(question?.querySelector('bdi')?.textContent).toBe('Luca')

    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }))
    expect(onRemove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Togli Luca' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sì, togli' }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledExactlyOnceWith(idOf('Luca')))
  })

  it('gives the focus back to the button that asked on cancel, and to the list once removed', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    render(<PeoplePanel event={fixtureEvent('Giulia')} marking={nobody} saveState="saved" onRemove={onRemove} />)

    fireEvent.click(screen.getByRole('button', { name: 'Togli Luca' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sì, togli' }))
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Togli Luca' }))

    fireEvent.click(screen.getByRole('button', { name: 'Togli Luca' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sì, togli' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading')))
  })

  it('gives the focus back to the button that asked when the server refuses', async () => {
    const onRemove = vi.fn().mockRejectedValue(new ApiError('network', 0))
    render(<PeoplePanel event={fixtureEvent('Giulia')} marking={nobody} saveState="saved" onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Togli Luca' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sì, togli' }))
    await screen.findByRole('alert')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Togli Luca' })))
  })
})

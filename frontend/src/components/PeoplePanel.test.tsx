import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
    expect(screen.getByText('Togliere Luca? Spariscono anche le sue fasce.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }))
    expect(onRemove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Togli Luca' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sì, togli' }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledExactlyOnceWith(idOf('Luca')))
  })
})

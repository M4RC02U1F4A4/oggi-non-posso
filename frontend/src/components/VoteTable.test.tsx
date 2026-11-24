import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { closedFixtureEvent, fixtureEvent } from '../test/fixture'
import { VoteTable } from './VoteTable'

describe('VoteTable, marking', () => {
  it('makes every candidate cell a button that says the day, the slot and the state', () => {
    render(<VoteTable event={fixtureEvent('Anna')} mode="mark" onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'sabato 12, cena: puoi' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'sabato 12, pranzo: non puoi' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'sabato 12, mattina: non puoi. Non può nemmeno Paolo' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'domenica 13, cena: puoi. Non possono Marta e Paolo' })).toBeDefined()
    // 6 day headers + 26 candidate pairs; the 4 slots not in play are not buttons.
    expect(screen.getAllByRole('button')).toHaveLength(32)
    expect(screen.getByText('venerdì 11, mattina: non in programma')).toBeDefined()
  })

  it('toggles one pair on a cell and the whole day on its header', () => {
    const onToggle = vi.fn()
    render(<VoteTable event={fixtureEvent('Anna')} mode="mark" onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: 'sabato 12, cena: puoi' }))
    expect(onToggle).toHaveBeenLastCalledWith([{ date: '2026-12-12', slot: 'dinner' }])

    fireEvent.click(screen.getByRole('button', { name: 'venerdì 11: segna tutto il giorno' }))
    expect(onToggle).toHaveBeenLastCalledWith([
      { date: '2026-12-11', slot: 'afternoon' },
      { date: '2026-12-11', slot: 'dinner' },
      { date: '2026-12-11', slot: 'after_dinner' },
    ])
    // Anna marked every slot of Friday 18: its header offers to clear them.
    expect(screen.getByRole('button', { name: 'venerdì 18: togli tutto il giorno' })).toBeDefined()
  })

  it('names who is missing after a long press, without marking', () => {
    vi.useFakeTimers()
    try {
      const onToggle = vi.fn()
      render(<VoteTable event={fixtureEvent('Anna')} mode="mark" onToggle={onToggle} />)
      const cell = screen.getByRole('button', { name: /^domenica 13, cena/ })

      fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 10 })
      act(() => void vi.advanceTimersByTime(500))
      fireEvent.pointerUp(cell)
      fireEvent.click(cell)

      expect(screen.getByRole('status').textContent).toBe('Non possono Marta e Paolo')
      expect(onToggle).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('VoteTable, looking only', () => {
  it('offers no way to mark to a visitor, and names who is missing on a tap', () => {
    render(<VoteTable event={fixtureEvent()} mode="read" />)
    expect(screen.queryByRole('button', { name: /segna tutto il giorno/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /: puoi/ })).toBeNull()

    const cell = screen.getByRole('button', { name: 'sabato 12, mattina: non possono Anna e Paolo' })
    fireEvent.click(cell)
    expect(screen.getByRole('status').textContent).toBe('Non possono Anna e Paolo')
    fireEvent.click(cell)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the count of the caller too on the closed event, and zero where everyone is free', () => {
    const { container } = render(<VoteTable event={closedFixtureEvent('Anna')} mode="result" variant="mini" />)
    expect(container.querySelectorAll('.is-mine')).toHaveLength(0)
    expect(container.querySelectorAll('.is-free')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'venerdì 18, pomeriggio: non possono Luca, Anna, Marta e Paolo' })).toBeDefined()
  })
})

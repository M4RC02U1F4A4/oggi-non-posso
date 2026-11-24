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

  it('writes the names in the cells, each kept apart from the others', () => {
    render(<VoteTable event={fixtureEvent('Anna')} mode="mark" onToggle={vi.fn()} />)
    const names = screen.getByRole('button', { name: /^domenica 13, cena/ }).querySelector('.vt__names')
    expect(names?.textContent).toBe('Marta, Paolo')
    expect([...(names?.querySelectorAll('bdi') ?? [])].map((name) => name.textContent)).toEqual(['Marta', 'Paolo'])
  })

  it('writes two names and how many more in a crowded cell', () => {
    render(<VoteTable event={fixtureEvent('Giulia')} mode="mark" onToggle={vi.fn()} />)
    const names = screen.getByRole('button', { name: /^venerdì 18, pomeriggio/ }).querySelector('.vt__names')
    expect(names?.textContent).toBe('Luca, Anna +2')
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
      expect([...screen.getByRole('status').querySelectorAll('bdi')].map((name) => name.textContent)).toEqual([
        'Marta',
        'Paolo',
      ])
      expect(onToggle).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('VoteTable, with the names open', () => {
  /** Holds a finger on a cell until the names open. */
  function longPress(cell: HTMLElement) {
    fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 10 })
    act(() => void vi.advanceTimersByTime(500))
    fireEvent.pointerUp(cell)
  }

  /** A tap as a browser delivers it: down, up, click. */
  function tap(element: HTMLElement) {
    fireEvent.pointerDown(element, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(element)
    fireEvent.click(element)
  }

  it('closes them at the next tap on a cell, and marks nothing', () => {
    vi.useFakeTimers()
    try {
      const onToggle = vi.fn()
      render(<VoteTable event={fixtureEvent('Anna')} mode="mark" onToggle={onToggle} />)
      longPress(screen.getByRole('button', { name: /^domenica 13, cena/ }))
      expect(screen.getByRole('status')).toBeDefined()

      // The bubble lets taps through: this is the cell under it.
      tap(screen.getByRole('button', { name: /^sabato 19, cena/ }))
      expect(screen.queryByRole('status')).toBeNull()
      expect(onToggle).not.toHaveBeenCalled()

      tap(screen.getByRole('button', { name: /^sabato 19, cena/ }))
      expect(onToggle).toHaveBeenCalledExactlyOnceWith([{ date: '2026-12-19', slot: 'dinner' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes them at a tap on a day, without marking the day', () => {
    vi.useFakeTimers()
    try {
      const onToggle = vi.fn()
      render(<VoteTable event={fixtureEvent('Anna')} mode="mark" onToggle={onToggle} />)
      longPress(screen.getByRole('button', { name: /^domenica 13, cena/ }))

      const day = screen.getByRole('button', { name: 'sabato 19: segna tutto il giorno' })
      tap(day)
      expect(screen.queryByRole('status')).toBeNull()
      expect(onToggle).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes them at a tap elsewhere in the table, outside it, or on Escape', () => {
    vi.useFakeTimers()
    try {
      render(<VoteTable event={fixtureEvent('Anna')} mode="mark" onToggle={vi.fn()} />)
      const cell = screen.getByRole('button', { name: /^domenica 13, cena/ })

      longPress(cell)
      fireEvent.click(screen.getByText('venerdì 11, mattina: non in programma'))
      expect(screen.queryByRole('status')).toBeNull()

      longPress(cell)
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('status')).toBeNull()

      longPress(cell)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('VoteTable, more than one month', () => {
  it('names the month in every accessible name', () => {
    const event = fixtureEvent('Anna', {
      slots: ['dinner'],
      days: [
        { date: '2026-12-31', slots: ['dinner'] },
        { date: '2027-01-02', slots: ['dinner'] },
      ],
    })
    render(<VoteTable event={event} mode="mark" onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'giovedì 31 dicembre, cena: puoi' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'sabato 2 gennaio, cena: puoi' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'sabato 2 gennaio: segna tutto il giorno' })).toBeDefined()
  })

  it('leaves the month out while every day is in the same one', () => {
    render(<VoteTable event={fixtureEvent('Anna')} mode="mark" onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'venerdì 11: segna tutto il giorno' })).toBeDefined()
  })
})

describe('VoteTable, looking only', () => {
  it('offers no way to mark to a visitor, and names who is missing on a tap', () => {
    render(<VoteTable event={fixtureEvent()} mode="read" />)
    expect(screen.queryByRole('button', { name: /segna tutto il giorno/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /: puoi/ })).toBeNull()

    expect(screen.getByText('venerdì 11, dopocena: ci siete tutti')).toBeDefined()
    const cell = screen.getByRole('button', { name: 'sabato 12, mattina: non possono Anna e Paolo' })
    fireEvent.click(cell)
    expect(screen.getByRole('status').textContent).toBe('Non possono Anna e Paolo')
    fireEvent.click(cell)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the count of the caller too on the closed event, and zero where everyone is free', () => {
    const { container } = render(<VoteTable event={closedFixtureEvent('Anna')} mode="result" variant="mini" />)
    expect(container.querySelectorAll('.is-mine')).toHaveLength(0)
    const free = [...container.querySelectorAll('.is-free')]
    expect(free).toHaveLength(5)
    // Everyone free is a visible zero, not an empty yellow cell.
    for (const cell of free) expect(cell.querySelector('.vt__count')?.textContent).toBe('0')
    const counts = [...container.querySelectorAll('.vt__count')].map((count) => count.textContent)
    expect(counts.slice(0, 3)).toEqual(['3', '1', '0'])
    expect(screen.getByRole('button', { name: 'venerdì 18, pomeriggio: non possono Luca, Anna, Marta e Paolo' })).toBeDefined()
  })
})

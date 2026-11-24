import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DayPicker } from './DayPicker'

const TODAY = '2026-11-24'

function setup(selected: string[] = [], max = 62) {
  const onToggle = vi.fn()
  render(<DayPicker selected={selected} onToggle={onToggle} today={TODAY} max={max} />)
  return onToggle
}

const dayButtons = () => screen.getAllByRole('button').filter((button) => button.classList.contains('picker__day'))

describe('DayPicker', () => {
  it('opens on the month of today, Monday first', () => {
    setup()
    expect(screen.getByText('novembre 2026')).toBeDefined()
    expect(dayButtons()).toHaveLength(30)
    const grid = screen.getByRole('group', { name: 'novembre 2026' })
    expect([...grid.children].slice(0, 7).map((cell) => cell.textContent)).toEqual([
      'lun',
      'mar',
      'mer',
      'gio',
      'ven',
      'sab',
      'dom',
    ])
    // 1 November 2026 is a Sunday: six blanks come before it.
    expect([...grid.children].slice(7, 14).map((cell) => cell.textContent)).toEqual(['', '', '', '', '', '', '1'])
  })

  it('does not let a past day be picked, and lets today be', () => {
    const onToggle = setup()
    const yesterday = screen.getByRole('button', { name: 'lunedì 23 novembre 2026: già passato' })
    expect(yesterday).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'martedì 24 novembre 2026' }))
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('2026-11-24')
  })

  it('moves to the next month and back, never before the month of today', () => {
    const onToggle = setup()
    const previous = screen.getByRole('button', { name: 'Mese precedente' })
    expect(previous).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Mese successivo' }))
    expect(screen.getByText('dicembre 2026')).toBeDefined()
    expect(dayButtons()).toHaveLength(31)
    fireEvent.click(screen.getByRole('button', { name: 'venerdì 11 dicembre 2026' }))
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('2026-12-11')

    fireEvent.click(screen.getByRole('button', { name: 'Mese successivo' }))
    expect(screen.getByText('gennaio 2027')).toBeDefined()

    fireEvent.click(previous)
    fireEvent.click(previous)
    expect(screen.getByText('novembre 2026')).toBeDefined()
    expect(previous).toHaveProperty('disabled', true)
  })

  it('shows which days are picked and unpicks on a tap', () => {
    const onToggle = setup(['2026-11-28', '2026-12-11'])
    const picked = screen.getByRole('button', { name: 'sabato 28 novembre 2026' })
    expect(picked.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'domenica 29 novembre 2026' }).getAttribute('aria-pressed')).toBe('false')
    expect(dayButtons().filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)

    fireEvent.click(picked)
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('2026-11-28')
  })

  it('takes no more days once the limit is reached, but still lets one go', () => {
    setup(['2026-11-28', '2026-11-29'], 2)
    expect(screen.getByRole('status').textContent).toBe('Al massimo 2 giorni: togline uno per aggiungerne un altro.')
    expect(screen.getByRole('button', { name: 'lunedì 30 novembre 2026' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'sabato 28 novembre 2026' })).toHaveProperty('disabled', false)
  })
})

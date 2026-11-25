import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { closedFixtureEvent } from '../test/fixture'
import { ResultView } from './ResultView'

describe('ResultView', () => {
  it('says who is missing in each near miss, each name kept apart', () => {
    const { container } = render(<ResultView event={closedFixtureEvent('Anna')} />)
    const rows = [...container.querySelectorAll('.result__near')]
    expect(rows).toHaveLength(7)
    const missing = rows[0]?.querySelector('.result__who')
    expect(missing?.textContent).toBe('manca Luca')
    expect(missing?.querySelector('bdi')?.textContent).toBe('Luca')
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Ci siete tutti',
      'Se manca una persona sola',
      'Tutto il calendario',
    ])
    expect(container.querySelectorAll('.result__free')).toHaveLength(3)
  })

  it('says "tu" when the caller is the one missing', () => {
    const { container } = render(<ResultView event={closedFixtureEvent('Luca')} />)
    const missing = container.querySelector('.result__near .result__who')
    expect(missing?.textContent).toBe('manchi tu')
  })
})

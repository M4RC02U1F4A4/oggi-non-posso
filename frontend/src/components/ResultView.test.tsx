import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { closedFixtureEvent } from '../test/fixture'
import { ResultView } from './ResultView'

describe('ResultView', () => {
  it('says who is missing in each near miss, each name kept apart', () => {
    const { container } = render(<ResultView event={closedFixtureEvent('Anna')} />)
    const rows = [...container.querySelectorAll('.result__near')]
    expect(rows).toHaveLength(7)
    const missing = rows[0]?.querySelector('em')
    expect(missing?.textContent).toBe('senza Luca')
    expect(missing?.querySelector('bdi')?.textContent).toBe('Luca')
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Ci siete tutti',
      'Se manca una persona sola',
      'Tutto il calendario',
    ])
  })
})

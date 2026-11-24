import { describe, expect, it } from 'vitest'
import { EVENT_ID, ORGANISER_KEY } from '../test/fixture'
import { isUuid } from './uuid'

describe('isUuid', () => {
  it('accepts the canonical lower-case form', () => {
    expect(isUuid(EVENT_ID)).toBe(true)
    expect(isUuid(ORGANISER_KEY)).toBe(true)
    expect(isUuid('3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10')).toBe(true)
  })

  it('rejects everything else', () => {
    for (const value of [
      '',
      'anything',
      'k7Qm2xVd9LpA',
      '3F2B8C1E-9A47-4D0B-8E65-1C7A2F9D4B10',
      '3f2b8c1e9a474d0b8e651c7a2f9d4b10',
      '3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b1',
      '3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b100',
      '3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b1g',
      ' 3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10',
      '3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10/',
      '{3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10}',
      null,
      undefined,
    ]) {
      expect(isUuid(value)).toBe(false)
    }
  })
})

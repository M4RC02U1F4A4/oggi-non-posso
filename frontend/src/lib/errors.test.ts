import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODES } from '../api/types'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('has Italian words for every code', () => {
    for (const code of ERROR_CODES) {
      const text = errorMessage(new ApiError(code, 0))
      expect(text.length).toBeGreaterThan(10)
      expect(text).not.toContain(code)
    }
  })

  it('says how long to wait when the answer said so', () => {
    expect(errorMessage(new ApiError('rate_limited', 429))).toBe('Troppe richieste: riprova più tardi.')
    expect(errorMessage(new ApiError('rate_limited', 429, undefined, 1500))).toBe(
      'Troppe richieste: riprova tra 25 minuti.',
    )
    expect(errorMessage(new ApiError('rate_limited', 429, undefined, 61))).toBe(
      'Troppe richieste: riprova tra 2 minuti.',
    )
    expect(errorMessage(new ApiError('rate_limited', 429, undefined, 20))).toBe(
      'Troppe richieste: riprova tra un minuto.',
    )
    expect(errorMessage(new ApiError('rate_limited', 429, undefined, 0))).toBe(
      'Troppe richieste: riprova tra un minuto.',
    )
  })

  it('takes anything that is not an answer of the API for an internal error', () => {
    expect(errorMessage(new Error('boom'))).toBe(errorMessage(new ApiError('internal', 500)))
  })
})

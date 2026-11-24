import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetParticipant,
  load,
  organiserUrl,
  saveOrganiser,
  saveParticipant,
  shareUrl,
} from './credentials'
import { EVENT_ID, ORGANISER_KEY } from '../test/fixture'

beforeEach(() => {
  window.localStorage.clear()
})

describe('credentials', () => {
  it('keeps them by event', () => {
    saveParticipant('abc', 'p_one')
    saveOrganiser('abc', ORGANISER_KEY)
    saveParticipant('xyz', 'p_two')
    expect(load('abc')).toEqual({ participant: 'p_one', organiser: ORGANISER_KEY })
    expect(load('xyz')).toEqual({ participant: 'p_two' })
    expect(load('other')).toEqual({})
  })

  it('forgets the participant and keeps the organiser key', () => {
    saveParticipant('abc', 'p_one')
    saveOrganiser('abc', ORGANISER_KEY)
    forgetParticipant('abc')
    expect(load('abc')).toEqual({ organiser: ORGANISER_KEY })

    saveParticipant('xyz', 'p_two')
    forgetParticipant('xyz')
    expect(load('xyz')).toEqual({})
    expect(window.localStorage.length).toBe(1)
  })

  it('survives a broken entry', () => {
    window.localStorage.setItem('onp:event:abc', '{not json')
    expect(load('abc')).toEqual({})
  })
})

describe('without a working localStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const refuseWrites = () =>
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })

  const takeStorageAway = () =>
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })

  it('keeps the credentials in memory when storage can not be reached', () => {
    takeStorageAway()
    saveParticipant('gone-1', 'p_one')
    saveOrganiser('gone-1', ORGANISER_KEY)
    expect(load('gone-1')).toEqual({ participant: 'p_one', organiser: ORGANISER_KEY })
    expect(load('gone-other')).toEqual({})

    forgetParticipant('gone-1')
    expect(load('gone-1')).toEqual({ organiser: ORGANISER_KEY })
  })

  it('keeps them in memory when storage refuses the write', () => {
    refuseWrites()
    saveParticipant('full-1', 'p_one')
    expect(window.localStorage.getItem('onp:event:full-1')).toBeNull()
    expect(load('full-1')).toEqual({ participant: 'p_one' })
  })

  it('prefers what it could not write to what storage still holds', () => {
    saveParticipant('full-2', 'p_old')
    refuseWrites()
    saveParticipant('full-2', 'p_new')
    expect(load('full-2')).toEqual({ participant: 'p_new' })
  })

  it('goes back to storage as soon as a write gets through', () => {
    const refusing = refuseWrites()
    saveParticipant('full-3', 'p_one')
    refusing.mockRestore()

    saveOrganiser('full-3', ORGANISER_KEY)
    expect(JSON.parse(window.localStorage.getItem('onp:event:full-3') ?? '{}')).toEqual({
      participant: 'p_one',
      organiser: ORGANISER_KEY,
    })
    // Nothing is left in memory: storage alone answers from here on.
    window.localStorage.clear()
    expect(load('full-3')).toEqual({})
  })

  it('hands out copies, not the object it keeps', () => {
    takeStorageAway()
    saveParticipant('gone-2', 'p_one')
    load('gone-2').participant = 'p_changed'
    expect(load('gone-2')).toEqual({ participant: 'p_one' })
  })
})

describe('links', () => {
  it('builds the share link and the organiser link', () => {
    expect(shareUrl('https://oggi.example.org', 'abc')).toBe('https://oggi.example.org/e/abc')
    expect(shareUrl('https://oggi.example.org', EVENT_ID)).toBe(
      'https://oggi.example.org/e/11111111-2222-4333-8444-555555555555',
    )
    expect(organiserUrl('https://oggi.example.org', EVENT_ID, ORGANISER_KEY)).toBe(
      'https://oggi.example.org/e/11111111-2222-4333-8444-555555555555/o/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
  })
})

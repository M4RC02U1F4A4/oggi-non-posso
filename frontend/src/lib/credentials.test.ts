import { beforeEach, describe, expect, it } from 'vitest'
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

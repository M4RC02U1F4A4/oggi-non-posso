import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetParticipant,
  load,
  organiserUrl,
  readOrganiserFragment,
  saveOrganiser,
  saveParticipant,
  shareUrl,
  stripOrganiserFragment,
} from './credentials'

beforeEach(() => {
  window.localStorage.clear()
})

describe('credentials', () => {
  it('keeps them by event', () => {
    saveParticipant('abc', 'p_one')
    saveOrganiser('abc', 'o_one')
    saveParticipant('xyz', 'p_two')
    expect(load('abc')).toEqual({ participant: 'p_one', organiser: 'o_one' })
    expect(load('xyz')).toEqual({ participant: 'p_two' })
    expect(load('other')).toEqual({})
  })

  it('forgets the participant and keeps the organiser key', () => {
    saveParticipant('abc', 'p_one')
    saveOrganiser('abc', 'o_one')
    forgetParticipant('abc')
    expect(load('abc')).toEqual({ organiser: 'o_one' })

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

const KEY = 'o_l2LAqg8HSphf5JRtEpomL5quhOig2zHq9KZ24zdtHT8'

describe('readOrganiserFragment', () => {
  it('finds the key of an organiser link', () => {
    expect(readOrganiserFragment(`#o=${KEY}`)).toEqual({ present: true, key: KEY })
  })

  it('stores nothing by itself', () => {
    saveOrganiser('abc', 'o_stored')
    readOrganiserFragment(`#o=${KEY}`)
    expect(load('abc')).toEqual({ organiser: 'o_stored' })
  })

  it('does not take for a key what has not the shape of one', () => {
    for (const hash of [
      '#o=',
      '#o=anything',
      '#o=o_short',
      '#o=p_l2LAqg8HSphf5JRtEpomL5quhOig2zHq9KZ24zdtHT8',
      '#o=o_l2LAqg8HSphf5JRtEpomL5quhOig2zHq9KZ24zdtHT8<script>',
      '#o=o_l2LAqg8HSphf5JRtEpomL5quhOig2zHq9KZ24zd HT8',
      `#o=o_${'a'.repeat(65)}`,
    ]) {
      expect(readOrganiserFragment(hash)).toEqual({ present: true, key: null })
    }
  })

  it('leaves an ordinary address alone', () => {
    expect(readOrganiserFragment('')).toEqual({ present: false, key: null })
    expect(readOrganiserFragment('#calendar')).toEqual({ present: false, key: null })
  })
})

describe('stripOrganiserFragment', () => {
  const fakeHistory = () => ({ state: { idx: 3 }, replaceState: vi.fn() })

  it('takes the fragment out of the address, whatever it holds', () => {
    for (const hash of [`#o=${KEY}`, '#o=anything', '#o=', '#o=<script>']) {
      const history = fakeHistory()
      expect(stripOrganiserFragment({ hash, pathname: '/e/abc', search: '?x=1' }, history)).toBe(true)
      expect(history.replaceState).toHaveBeenCalledExactlyOnceWith({ idx: 3 }, '', '/e/abc?x=1')
    }
  })

  it('does not touch an address without one', () => {
    const history = fakeHistory()
    expect(stripOrganiserFragment({ hash: '', pathname: '/e/abc', search: '' }, history)).toBe(false)
    expect(stripOrganiserFragment({ hash: '#calendar', pathname: '/e/abc', search: '' }, history)).toBe(false)
    expect(history.replaceState).not.toHaveBeenCalled()
  })
})

describe('links', () => {
  it('builds the share link and the organiser link', () => {
    expect(shareUrl('https://oggi.example.org', 'abc')).toBe('https://oggi.example.org/e/abc')
    expect(organiserUrl('https://oggi.example.org', 'abc', 'o_key')).toBe('https://oggi.example.org/e/abc#o=o_key')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureOrganiserKey,
  forgetParticipant,
  load,
  organiserUrl,
  saveOrganiser,
  saveParticipant,
  shareUrl,
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

describe('captureOrganiserKey', () => {
  const fakeHistory = () => ({ state: { idx: 3 }, replaceState: vi.fn() })

  it('stores the key of the organiser link and strips the fragment', () => {
    const history = fakeHistory()
    const location = { hash: '#o=o_Zx9-_kQ', pathname: '/e/abc', search: '' }
    expect(captureOrganiserKey('abc', location, history)).toBe(true)
    expect(load('abc')).toEqual({ organiser: 'o_Zx9-_kQ' })
    expect(history.replaceState).toHaveBeenCalledWith({ idx: 3 }, '', '/e/abc')
  })

  it('keeps the participant token it already had', () => {
    saveParticipant('abc', 'p_one')
    captureOrganiserKey('abc', { hash: '#o=o_key', pathname: '/e/abc', search: '?x=1' }, fakeHistory())
    expect(load('abc')).toEqual({ participant: 'p_one', organiser: 'o_key' })
  })

  it('leaves an ordinary address alone', () => {
    const history = fakeHistory()
    expect(captureOrganiserKey('abc', { hash: '', pathname: '/e/abc', search: '' }, history)).toBe(false)
    expect(captureOrganiserKey('abc', { hash: '#calendar', pathname: '/e/abc', search: '' }, history)).toBe(false)
    expect(history.replaceState).not.toHaveBeenCalled()
    expect(load('abc')).toEqual({})
  })

  it('strips a fragment that is not a key without storing it', () => {
    const history = fakeHistory()
    expect(captureOrganiserKey('abc', { hash: '#o=<script>', pathname: '/e/abc', search: '' }, history)).toBe(false)
    expect(history.replaceState).toHaveBeenCalledOnce()
    expect(load('abc')).toEqual({})
  })
})

describe('links', () => {
  it('builds the share link and the organiser link', () => {
    expect(shareUrl('https://oggi.example.org', 'abc')).toBe('https://oggi.example.org/e/abc')
    expect(organiserUrl('https://oggi.example.org', 'abc', 'o_key')).toBe('https://oggi.example.org/e/abc#o=o_key')
  })
})

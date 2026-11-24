import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamUpdate } from '../api/types'
import { FakeEventSource, installFakeEventSource, setVisibility } from '../test/eventSource'
import { useEventStream } from './useEventStream'

beforeEach(() => {
  vi.useFakeTimers()
  installFakeEventSource()
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useEventStream', () => {
  it('opens the stream of the event and passes its updates on', () => {
    const onUpdate = vi.fn<(update: StreamUpdate) => void>()
    renderHook(() => useEventStream('abc', onUpdate))

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.latest().url).toBe('/api/events/abc/stream')

    FakeEventSource.latest().emit({ version: 13, kind: 'absences', by: 'pid' })
    expect(onUpdate).toHaveBeenCalledWith({ version: 13, kind: 'absences', by: 'pid' })
  })

  it('ignores what is not an update', () => {
    const onUpdate = vi.fn()
    renderHook(() => useEventStream('abc', onUpdate))
    FakeEventSource.latest().emitRaw('not json')
    FakeEventSource.latest().emitRaw('{"kind":"absences"}')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('reconnects after an error, waiting longer each time', () => {
    renderHook(() => useEventStream('abc', vi.fn()))
    const first = FakeEventSource.latest()

    first.fail()
    expect(first.closed).toBe(true)
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)

    FakeEventSource.latest().fail()
    vi.advanceTimersByTime(1_999)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(3)
    expect(FakeEventSource.open()).toHaveLength(1)
  })

  it('starts again from a short wait once a connection opened', () => {
    renderHook(() => useEventStream('abc', vi.fn()))
    FakeEventSource.latest().fail()
    vi.advanceTimersByTime(1_000)
    FakeEventSource.latest().fail()
    vi.advanceTimersByTime(2_000)
    expect(FakeEventSource.instances).toHaveLength(3)

    FakeEventSource.latest().connect()
    FakeEventSource.latest().fail()
    vi.advanceTimersByTime(1_000)
    expect(FakeEventSource.instances).toHaveLength(4)
  })

  it('never waits more than half a minute', () => {
    renderHook(() => useEventStream('abc', vi.fn()))
    for (let i = 0; i < 12; i++) {
      FakeEventSource.latest().fail()
      vi.advanceTimersByTime(30_000)
    }
    expect(FakeEventSource.instances).toHaveLength(13)
  })

  it('lets go of the stream while hidden and takes it back when visible', () => {
    const onUpdate = vi.fn()
    renderHook(() => useEventStream('abc', onUpdate))
    const first = FakeEventSource.latest()

    setVisibility('hidden')
    expect(first.closed).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)

    setVisibility('visible')
    expect(FakeEventSource.instances).toHaveLength(2)
    FakeEventSource.latest().emit({ version: 14, kind: 'status', by: null })
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('closes the stream when the page goes away or is told not to listen', () => {
    const { unmount } = renderHook(() => useEventStream('abc', vi.fn()))
    const source = FakeEventSource.latest()
    source.fail()
    unmount()
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)

    renderHook(() => useEventStream('abc', vi.fn(), false))
    expect(FakeEventSource.instances).toHaveLength(1)
  })
})

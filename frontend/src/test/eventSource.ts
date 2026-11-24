// A stand-in for the browser's EventSource that tests drive by hand.

import { vi } from 'vitest'
import type { StreamUpdate } from '../api/types'

type Listener = (message: { data: string }) => void

export class FakeEventSource {
  static instances: FakeEventSource[] = []

  /** The connections still open, oldest first. */
  static open(): FakeEventSource[] {
    return FakeEventSource.instances.filter((source) => !source.closed)
  }

  static latest(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1)
    if (!source) throw new Error('no EventSource was opened')
    return source
  }

  readonly url: string
  closed = false
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private readonly listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close(): void {
    this.closed = true
  }

  connect(): void {
    this.onopen?.()
  }

  emit(update: StreamUpdate): void {
    this.emitRaw(JSON.stringify(update))
  }

  emitRaw(data: string): void {
    for (const listener of this.listeners.get('update') ?? []) listener({ data })
  }

  fail(): void {
    this.onerror?.()
  }
}

export function installFakeEventSource(): void {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
}

let visibility: DocumentVisibilityState = 'visible'

/** Makes the page hidden or visible, as switching tabs or locking a phone does. */
export function setVisibility(state: DocumentVisibilityState): void {
  visibility = state
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  document.dispatchEvent(new Event('visibilitychange'))
}

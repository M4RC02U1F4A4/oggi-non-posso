import { useEffect, useRef } from 'react'
import { streamUrl } from '../api/client'
import type { StreamUpdate } from '../api/types'

export const FIRST_RETRY_MS = 1_000
export const MAX_RETRY_MS = 30_000

function parseUpdate(data: unknown): StreamUpdate | null {
  if (typeof data !== 'string') return null
  try {
    const update = JSON.parse(data) as Partial<StreamUpdate> | null
    if (!update || typeof update.version !== 'number') return null
    return {
      version: update.version,
      kind: update.kind ?? 'status',
      by: typeof update.by === 'string' ? update.by : null,
    }
  } catch {
    return null
  }
}

/**
 * Listens to an event's live stream. The stream only says that something
 * changed; the caller fetches the event again. A connection that drops is
 * opened again, waiting a little longer each time; a page that is hidden
 * lets go of the stream and takes it back when it is looked at again, which
 * is also what brings a phone back after it slept.
 */
export function useEventStream(
  id: string,
  onUpdate: (update: StreamUpdate) => void,
  enabled = true,
  /** Called each time the stream fails: the caller may want to look at the event itself. */
  onError?: () => void,
): void {
  const handler = useRef(onUpdate)
  const errorHandler = useRef(onError)
  useEffect(() => {
    handler.current = onUpdate
    errorHandler.current = onError
  })

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return

    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let stopped = false

    const disconnect = () => {
      clearTimeout(timer)
      timer = undefined
      source?.close()
      source = null
    }

    const connect = () => {
      disconnect()
      if (stopped) return
      const current = new EventSource(streamUrl(id))
      source = current
      current.onopen = () => {
        attempt = 0
      }
      current.addEventListener('update', (message) => {
        const update = parseUpdate((message as MessageEvent).data)
        if (update) handler.current(update)
      })
      current.onerror = () => {
        if (source !== current) return
        // Close it ourselves: the browser gives up for good on some failures
        // (an error status, for one) and retries on its own schedule on others.
        disconnect()
        const delay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt)
        attempt += 1
        timer = setTimeout(connect, delay)
        errorHandler.current?.()
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        attempt = 0
        connect()
      } else {
        disconnect()
      }
    }

    if (document.visibilityState !== 'hidden') connect()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [id, enabled])
}

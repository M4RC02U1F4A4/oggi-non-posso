import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { changeAbsences, closeEvent, getEvent, joinEvent, removeParticipant, reopenEvent } from '../api/client'
import {
  ApiError,
  errorCode,
  type AbsenceChange,
  type ErrorCode,
  type EventData,
  type Pair,
  type StreamUpdate,
} from '../api/types'
import { applyChanges, mergeChanges, toggleChange } from '../lib/absences'
import * as credentials from '../lib/credentials'
import { useEventStream } from './useEventStream'

/** How long "is marking now" stays on after a participant's last change. */
export const MARKING_MS = 8_000

export type LoadState = 'loading' | 'ready' | 'not_found' | 'error'
export type SaveState = 'saved' | 'saving' | 'failed'

export interface UseEvent {
  state: LoadState
  /** The event as the page shows it: the server's plus the caller's unconfirmed marks. */
  event?: EventData
  /** Why the first load failed, when `state` is `error`. */
  loadError: ErrorCode | null
  /** Participant ids that changed their marks in the last 8 seconds. */
  marking: Set<string>
  saveState: SaveState
  /** Why the last mark was not saved; null again at the next tap. */
  saveError: ErrorCode | null
  /** True when this browser's participant was removed and has to give a name again. */
  dropped: boolean
  /** True when the key of an organiser link turned out not to manage this event. */
  organiserLinkRejected: boolean
  /** Rejects with an ApiError the form can show (not for a closed event: the page just moves on). */
  join(name: string): Promise<void>
  /** Optimistic. One pair is a cell; a day's candidate pairs are the whole day. */
  toggle(pairs: Pair[]): void
  refresh(): void
  close(): Promise<void>
  reopen(): Promise<void>
  remove(participantId: string): Promise<void>
}

/**
 * `organiserCandidate` is a key read from an organiser link. It is not
 * trusted: the first read of the event carries it, and it is stored only if
 * the server answers that it manages the event. A key that does not is
 * dropped, and whatever key was stored before stays.
 */
export function useEvent(id: string, organiserCandidate?: string | null): UseEvent {
  const [state, setState] = useState<LoadState>('loading')
  const [server, setServer] = useState<EventData>()
  const [pending, setPending] = useState<AbsenceChange[]>([])
  const [loadError, setLoadError] = useState<ErrorCode | null>(null)
  const [saveError, setSaveError] = useState<ErrorCode | null>(null)
  const [dropped, setDropped] = useState(false)
  const [organiserLinkRejected, setOrganiserLinkRejected] = useState(false)
  const [marking, setMarking] = useState<Set<string>>(() => new Set())

  // The same values for the asynchronous paths, which must not read a stale render.
  const serverRef = useRef<EventData | undefined>(undefined)
  const pendingRef = useRef<AbsenceChange[]>([])
  const sendingRef = useRef(false)
  const loadingRef = useRef(false)
  const loadAgainRef = useRef(false)
  // Grows whenever the stored credentials change, so an answer asked for
  // with the old ones is thrown away instead of being believed.
  const epochRef = useRef(0)
  const aliveRef = useRef(true)
  // The key of an organiser link, until the server has had its say on it.
  const candidateRef = useRef(organiserCandidate ?? null)
  const markTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const accept = useCallback((event: EventData) => {
    const held = serverRef.current
    if (held && event.version < held.version) return
    serverRef.current = event
    setServer(event)
    setState('ready')
    setLoadError(null)
  }, [])

  const setQueue = useCallback((changes: AbsenceChange[]) => {
    pendingRef.current = changes
    setPending(changes)
  }, [])

  const forgetToken = useCallback(() => {
    credentials.forgetParticipant(id)
    epochRef.current += 1
    setQueue([])
  }, [id, setQueue])

  const load = useCallback(async () => {
    if (loadingRef.current) {
      loadAgainRef.current = true
      return
    }
    loadingRef.current = true
    try {
      do {
        loadAgainRef.current = false
        const epoch = epochRef.current
        const stored = credentials.load(id)
        const candidate = candidateRef.current
        try {
          const event = await getEvent(id, candidate === null ? stored : { ...stored, organiser: candidate })
          if (!aliveRef.current) return
          if (epoch !== epochRef.current) {
            loadAgainRef.current = true
            continue
          }
          if (candidate !== null) {
            // The server answered: the candidate is settled either way. (A
            // request that fails settles nothing, and the next one asks again.)
            candidateRef.current = null
            if (event.can_manage) {
              credentials.saveOrganiser(id, candidate)
            } else {
              setOrganiserLinkRejected(true)
              if (stored.organiser !== undefined) {
                // This answer was written for the rejected key. Ask again
                // with the stored one, which may well be good.
                loadAgainRef.current = true
                continue
              }
            }
          }
          if (event.me === null && stored.participant !== undefined) {
            // The token no longer names anyone: the participant was removed.
            forgetToken()
            setDropped(true)
          }
          accept(event)
        } catch (err) {
          if (!aliveRef.current) return
          const code = errorCode(err)
          if (code === 'not_found') {
            setState('not_found')
          } else if (!serverRef.current) {
            setLoadError(code)
            setState('error')
          }
          // Otherwise the page keeps what it has: the stream, or the next
          // time it becomes visible, asks again.
        }
      } while (loadAgainRef.current)
    } finally {
      loadingRef.current = false
    }
  }, [id, accept, forgetToken])

  const send = useCallback(async () => {
    if (sendingRef.current) return
    sendingRef.current = true
    try {
      while (pendingRef.current.length > 0) {
        const token = credentials.load(id).participant
        if (token === undefined) {
          setQueue([])
          void load()
          return
        }
        const batch = pendingRef.current
        try {
          const event = await changeAbsences(id, token, mergeChanges(batch))
          if (!aliveRef.current) return
          // The answer is written for a participant; whether this browser
          // also organises is something only a read with both credentials says.
          accept({ ...event, can_manage: serverRef.current?.can_manage ?? event.can_manage })
          setQueue(pendingRef.current.slice(batch.length))
        } catch (err) {
          if (!aliveRef.current) return
          const code = errorCode(err)
          if (code === 'event_closed' || code === 'not_found') {
            // Not an error to show: the page was stale. Fetch and move on.
            setQueue([])
            await load()
          } else if (code === 'unauthorized') {
            forgetToken()
            setDropped(true)
            await load()
          } else {
            setQueue(pendingRef.current.slice(batch.length))
            setSaveError(code)
          }
        }
      }
    } finally {
      sendingRef.current = false
    }
  }, [id, accept, forgetToken, load, setQueue])

  const toggle = useCallback(
    (pairs: Pair[]) => {
      const held = serverRef.current
      if (!held) return
      const change = toggleChange(applyChanges(held, pendingRef.current), pairs)
      if (!change) return
      setSaveError(null)
      setQueue([...pendingRef.current, change])
      void send()
    },
    [send, setQueue],
  )

  const join = useCallback(
    async (name: string) => {
      try {
        const joined = await joinEvent(id, name)
        credentials.saveParticipant(id, joined.participant_token)
        epochRef.current += 1
        setDropped(false)
        accept({
          ...joined.event,
          // Whoever just joined is the last of the list, whatever the answer says of "me".
          me: joined.event.me ?? joined.event.participants.at(-1)?.id ?? null,
          can_manage: serverRef.current?.can_manage ?? joined.event.can_manage,
        })
      } catch (err) {
        if (errorCode(err) !== 'event_closed') throw err
        await load()
      }
    },
    [id, accept, load],
  )

  const manage = useCallback(
    async (action: (key: string) => Promise<EventData>, removedId?: string) => {
      const key = credentials.load(id).organiser
      if (key === undefined) throw new ApiError('unauthorized', 401)
      const event = await action(key)
      if (!aliveRef.current) return
      // Written for the organiser key alone: who this browser is as a
      // participant stays what it was, unless it just removed itself.
      let me = serverRef.current?.me ?? null
      if (removedId !== undefined && removedId === me) {
        forgetToken()
        me = null
      }
      accept({ ...event, me })
    },
    [id, accept, forgetToken],
  )

  const close = useCallback(() => manage((key) => closeEvent(id, key)), [id, manage])
  const reopen = useCallback(() => manage((key) => reopenEvent(id, key)), [id, manage])
  const remove = useCallback(
    (participantId: string) => manage((key) => removeParticipant(id, key, participantId), participantId),
    [id, manage],
  )

  const onUpdate = useCallback(
    (update: StreamUpdate) => {
      if (update.kind === 'absences' && update.by !== null) {
        const timers = markTimers.current
        const who = update.by
        clearTimeout(timers.get(who))
        timers.set(
          who,
          setTimeout(() => {
            timers.delete(who)
            setMarking(new Set(timers.keys()))
          }, MARKING_MS),
        )
        setMarking(new Set(timers.keys()))
      }
      const held = serverRef.current
      if (held && update.version <= held.version) return
      // The answer to a mark in flight will carry this same change.
      if (held && sendingRef.current && update.by !== null && update.by === held.me) return
      void load()
    },
    [load],
  )

  useEffect(() => {
    aliveRef.current = true
    void load()
    const timers = markTimers.current
    return () => {
      aliveRef.current = false
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [load])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [load])

  useEventStream(id, onUpdate, state === 'ready')

  const event = useMemo(() => (server ? applyChanges(server, pending) : undefined), [server, pending])
  const refresh = useCallback(() => void load(), [load])
  const saveState: SaveState = pending.length > 0 ? 'saving' : saveError !== null ? 'failed' : 'saved'

  return {
    state,
    event,
    loadError,
    marking,
    saveState,
    saveError,
    dropped,
    organiserLinkRejected,
    join,
    toggle,
    refresh,
    close,
    reopen,
    remove,
  }
}

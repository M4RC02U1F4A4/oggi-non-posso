import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { createEvent } from '../api/client'
import { Band } from '../components/Band'
import { CopyButton } from '../components/CopyButton'
import { DayPicker } from '../components/DayPicker'
import { SlotPicker } from '../components/SlotPicker'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { isolate, t, tNodes, type MessageKey } from '../i18n'
import * as credentials from '../lib/credentials'
import { todayISO } from '../lib/dates'
import { EMPTY_DRAFT, toEventDays, toggleDay, toggleDaySlot, toggleEventSlot } from '../lib/draft'
import { errorMessage } from '../lib/errors'
import { MAX_DAYS, MAX_NAME_LENGTH, MAX_TITLE_LENGTH, countCharacters } from '../lib/limits'
import '../styles/CreatePage.css'

/**
 * The event just created, as the history entry of `/` keeps it, so that a
 * reload or a step back finds the links again. The organiser key is not in
 * it: history state is not a place for a credential. It is read back from
 * the credentials of the event.
 */
interface Created {
  id: string
  title: string
  name: string
}

function createdOf(state: unknown): Created | null {
  if (typeof state !== 'object' || state === null || !('created' in state)) return null
  const created = (state as { created: unknown }).created
  if (typeof created !== 'object' || created === null) return null
  const { id, title, name } = created as Record<string, unknown>
  if (typeof id !== 'string' || typeof title !== 'string' || typeof name !== 'string') return null
  return { id, title, name }
}

export function CreatePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const created = createdOf(location.state)
  // Without its key (storage cleared, or only in the memory of a page now
  // gone) the screen has nothing left to hand over: start again.
  const key = created ? credentials.load(created.id).organiser : undefined
  if (created && key !== undefined) return <CreatedView created={created} organiserKey={key} />
  return (
    <CreateForm
      onCreated={(next) => void navigate('/', { replace: true, state: { created: next } })}
    />
  )
}

interface FieldErrors {
  title?: MessageKey
  name?: MessageKey
  days?: MessageKey
}

function CreateForm({ onCreated }: { onCreated: (created: Created) => void }) {
  useDocumentTitle()
  const [title, setTitle] = useState('')
  const [name, setName] = useState('')
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [today, setToday] = useState(() => todayISO())
  const titleRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const daysRef = useRef<HTMLDivElement>(null)
  const failureRef = useRef<HTMLParagraphElement>(null)
  const titleId = useId()
  const nameId = useId()
  const titleErrorId = useId()
  const nameErrorId = useId()

  // A page left open overnight, or brought back from another tab, has a new "today".
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setToday(todayISO())
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (failure !== null) failureRef.current?.scrollIntoView({ block: 'center' })
  }, [failure])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const cleanTitle = title.trim()
    const cleanName = name.trim()

    const found: FieldErrors = {}
    if (cleanTitle === '') found.title = 'create.error.title'
    else if (countCharacters(cleanTitle) > MAX_TITLE_LENGTH) found.title = 'create.error.titleLong'
    if (cleanName === '') found.name = 'create.error.name'
    else if (countCharacters(cleanName) > MAX_NAME_LENGTH) found.name = 'create.error.nameLong'
    if (draft.days.length === 0) found.days = 'create.error.days'
    setErrors(found)
    setFailure(null)
    if (found.title) return titleRef.current?.focus()
    if (found.name) return nameRef.current?.focus()
    if (found.days) return daysRef.current?.scrollIntoView({ block: 'center' })

    setBusy(true)
    try {
      const result = await createEvent({ title: cleanTitle, organiser_name: cleanName, days: toEventDays(draft) })
      credentials.saveParticipant(result.event.id, result.participant_token)
      credentials.saveOrganiser(result.event.id, result.organiser_key)
      onCreated({ id: result.event.id, title: result.event.title, name: cleanName })
    } catch (err) {
      setFailure(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="page page--bar">
      <Band title={t('create.title')} wide={t('create.tagline')} />
      <form className="wrap create" onSubmit={(e) => void submit(e)} noValidate>
        <div className="create__left">
          <div className="create__fields">
            <div>
              <label className="field-label" htmlFor={titleId}>
                {t('create.what')}
              </label>
              <input
                ref={titleRef}
                id={titleId}
                className="field"
                type="text"
                name="title"
                autoComplete="off"
                enterKeyHint="next"
                value={title}
                aria-invalid={errors.title !== undefined}
                aria-describedby={errors.title ? titleErrorId : undefined}
                onChange={(e) => setTitle(e.target.value)}
              />
              {errors.title && (
                <p className="field-error" id={titleErrorId} role="alert">
                  {t(errors.title)}
                </p>
              )}
            </div>
            <div>
              <label className="field-label" htmlFor={nameId}>
                {t('create.who')}
              </label>
              <input
                ref={nameRef}
                id={nameId}
                className="field"
                type="text"
                name="name"
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="done"
                value={name}
                aria-invalid={errors.name !== undefined}
                aria-describedby={errors.name ? nameErrorId : undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && (
                <p className="field-error" id={nameErrorId} role="alert">
                  {t(errors.name)}
                </p>
              )}
            </div>
          </div>

          <div ref={daysRef}>
            <DayPicker
              selected={draft.days}
              onToggle={(date) => {
                setDraft((current) => toggleDay(current, date))
                setErrors((current) => ({ ...current, days: undefined }))
              }}
              today={today}
              max={MAX_DAYS}
            />
            {errors.days && (
              <p className="field-error" role="alert">
                {t(errors.days)}
              </p>
            )}
          </div>
        </div>

        <div className="create__right">
          <SlotPicker
            draft={draft}
            onToggleSlot={(slot) => setDraft((current) => toggleEventSlot(current, slot))}
            onToggleDaySlot={(date, slot) => setDraft((current) => toggleDaySlot(current, date, slot))}
          />

          <div className="create__go">
            <p className="create__note">{t('create.note')}</p>
            {failure !== null && (
              <p className="alert create__failure" role="alert" ref={failureRef}>
                {failure}
              </p>
            )}
            <button type="submit" className="btn create__submit" disabled={busy}>
              {t(busy ? 'create.submitting' : 'create.submit')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

/** The organiser link with its middle left out: enough to recognise it, not to use it. */
function maskedOrganiserLink(host: string, eventId: string, key: string): string {
  return t('created.own.masked', {
    start: credentials.shareUrl(host, eventId.slice(0, 8)),
    end: key.slice(-4),
  })
}

/** Right after creating: the link for the others, the link to keep, the way in. */
function CreatedView({ created, organiserKey }: { created: Created; organiserKey: string }) {
  const { name } = created
  const event = { id: created.id, title: created.title }
  useDocumentTitle(event.title)
  const headingRef = useRef<HTMLDivElement>(null)
  const { origin, host } = window.location
  const shareLink = credentials.shareUrl(origin, event.id)
  const canShare = typeof navigator.share === 'function'

  useEffect(() => {
    window.scrollTo(0, 0)
    headingRef.current?.focus()
  }, [])

  const share = () => {
    // A share sheet closed without choosing is not an error to report.
    navigator
      .share({ title: event.title, text: t('created.shareText', { title: event.title }), url: shareLink })
      .catch(() => undefined)
  }

  return (
    <div className="page page--bar">
      <div ref={headingRef} tabIndex={-1} className="created__top">
        <Band eyebrow={event.title} title={t('created.title')} />
      </div>
      <main className="wrap created">
        <div className="created__cols">
          <section>
            <h2 className="section-title created__title">{t('created.others.title')}</h2>
            <p className="created__text">{t('created.others.text')}</p>
            <p className="created__url">{credentials.shareUrl(host, event.id)}</p>
            <div className="created__row">
              <CopyButton className="btn" text={shareLink} label={t('created.others.copy')} />
              {canShare && (
                <button type="button" className="btn btn--outline" onClick={share}>
                  {t('created.others.share')}
                </button>
              )}
            </div>
          </section>
          <section>
            <h2 className="section-title created__title">{t('created.own.title')}</h2>
            <p className="created__text">{t('created.own.text')}</p>
            <p className="created__url created__url--quiet">
              {maskedOrganiserLink(host, event.id, organiserKey)}
            </p>
            <div className="created__row">
              <CopyButton
                className="btn btn--outline"
                text={credentials.organiserUrl(origin, event.id, organiserKey)}
                label={t('created.own.copy')}
              />
            </div>
          </section>
        </div>
        <div className="created__next">
          <p className="only-wide">{tNodes('created.next.text', { name: isolate(name) })}</p>
          <Link className="btn created__open" to={`/e/${event.id}`}>
            {t('created.next.open')}
          </Link>
        </div>
      </main>
    </div>
  )
}

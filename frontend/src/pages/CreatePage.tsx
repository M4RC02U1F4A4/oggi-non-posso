import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { createEvent } from '../api/client'
import { errorCode, type CreatedEvent, type ErrorCode } from '../api/types'
import { Band } from '../components/Band'
import { CopyButton } from '../components/CopyButton'
import { DayPicker } from '../components/DayPicker'
import { SlotPicker } from '../components/SlotPicker'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { t, type MessageKey } from '../i18n'
import * as credentials from '../lib/credentials'
import { todayISO } from '../lib/dates'
import { EMPTY_DRAFT, toEventDays, toggleDay, toggleDaySlot, toggleEventSlot } from '../lib/draft'
import { MAX_DAYS, MAX_NAME_LENGTH, MAX_TITLE_LENGTH, countCharacters } from '../lib/limits'
import '../styles/CreatePage.css'

interface Created {
  event: CreatedEvent['event']
  organiserKey: string
  name: string
}

export function CreatePage() {
  const [created, setCreated] = useState<Created | null>(null)
  return created ? <CreatedView created={created} /> : <CreateForm onCreated={setCreated} />
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
  const [failure, setFailure] = useState<ErrorCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [today] = useState(() => todayISO())
  const titleRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const daysRef = useRef<HTMLDivElement>(null)
  const failureRef = useRef<HTMLParagraphElement>(null)
  const titleId = useId()
  const nameId = useId()
  const titleErrorId = useId()
  const nameErrorId = useId()

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
      onCreated({ event: result.event, organiserKey: result.organiser_key, name: cleanName })
    } catch (err) {
      setFailure(errorCode(err))
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
                {t(`error.${failure}`)}
              </p>
            )}
            <button type="submit" className="btn create__submit" disabled={busy}>
              {t('create.submit')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

/** The key with its middle left out: enough to recognise the link, not to use it. */
function maskKey(key: string): string {
  return t('created.own.masked', { start: key.slice(0, 5), end: key.slice(-3) })
}

/** Right after creating: the link for the others, the link to keep, the way in. */
function CreatedView({ created }: { created: Created }) {
  const { event, organiserKey, name } = created
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
              {credentials.organiserUrl(host, event.id, maskKey(organiserKey))}
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
          <p className="only-wide">{t('created.next.text', { name })}</p>
          <Link className="btn created__open" to={`/e/${event.id}`}>
            {t('created.next.open')}
          </Link>
        </div>
      </main>
    </div>
  )
}

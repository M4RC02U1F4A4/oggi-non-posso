import { useId, useState, type FormEvent } from 'react'
import { errorCode } from '../api/types'
import { t } from '../i18n'
import { MAX_NAME_LENGTH, countCharacters } from '../lib/limits'
import '../styles/JoinForm.css'

interface JoinFormProps {
  /** Rejects with an ApiError when the name is not accepted. */
  onJoin: (name: string) => Promise<void>
}

/** "What's your name?": the one thing asked before marking. */
export function JoinForm({ onJoin }: JoinFormProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()
  const errorId = useId()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (trimmed === '') return setError(t('join.empty'))
    if (countCharacters(trimmed) > MAX_NAME_LENGTH) return setError(t('join.tooLong'))
    setError(null)
    setBusy(true)
    try {
      await onJoin(trimmed)
    } catch (err) {
      setError(t(`error.${errorCode(err)}`))
      setBusy(false)
    }
    // On success the form goes away with the visitor it was for.
  }

  return (
    <form className="join" onSubmit={(e) => void submit(e)} noValidate>
      <label className="join__title" htmlFor={inputId}>
        {t('join.title')}
      </label>
      <input
        id={inputId}
        className="field"
        type="text"
        name="name"
        autoComplete="given-name"
        autoCapitalize="words"
        enterKeyHint="go"
        placeholder={t('join.placeholder')}
        value={name}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        onChange={(e) => setName(e.target.value)}
      />
      {error !== null && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--block join__submit" disabled={busy}>
        {t('join.submit')}
      </button>
    </form>
  )
}

import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { copyText } from '../lib/clipboard'

/** How long the button says "copied" before going back to its label. */
const FEEDBACK_MS = 2_500

interface CopyButtonProps {
  /** What goes to the clipboard. */
  text: string
  label: string
  /** For when the label alone ("Copia") does not say what it copies. */
  ariaLabel?: string
  className?: string
}

export function CopyButton({ text, label, ariaLabel, className }: CopyButtonProps) {
  const [outcome, setOutcome] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    const copied = await copyText(text)
    setOutcome(copied ? 'done' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOutcome('idle'), FEEDBACK_MS)
  }

  return (
    <>
      <button type="button" className={className} aria-label={ariaLabel} onClick={() => void copy()}>
        {outcome === 'done' ? t('copy.done') : outcome === 'failed' ? t('copy.failedShort') : label}
      </button>
      <span className="visually-hidden" role="status">
        {outcome === 'done' ? t('copy.done') : outcome === 'failed' ? t('copy.failed') : ''}
      </span>
    </>
  )
}

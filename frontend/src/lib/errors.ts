import { ApiError, errorCode } from '../api/types'
import { t } from '../i18n'

/** The words for anything a request threw: the backend sends codes, the page owns the text. */
export function errorMessage(err: unknown): string {
  const code = errorCode(err)
  if (code === 'rate_limited' && err instanceof ApiError && err.retryAfter !== undefined) {
    return t('error.rateLimitedWait', { count: Math.max(1, Math.ceil(err.retryAfter / 60)) })
  }
  return t(`error.${code}`)
}

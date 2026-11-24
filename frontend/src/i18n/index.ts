import { it, type Message } from './it'

export type MessageKey = keyof typeof it
export type Vars = Record<string, string | number>

const catalogue: Record<MessageKey, Message> = it

function pick(message: Message, key: string, vars: Vars | undefined): string {
  if (typeof message === 'string') return message
  const count = vars?.count
  if (typeof count !== 'number') {
    throw new Error(`i18n: "${key}" has plural forms and needs a numeric "count"`)
  }
  if (count === 0 && message.zero !== undefined) return message.zero
  return count === 1 ? message.one : message.other
}

/**
 * The text for a key of the catalogue, with `{name}` variables filled in.
 * A variable the text asks for and the caller did not pass is a bug: it
 * throws everywhere but in a production build, where the marker stays.
 */
export function t(key: MessageKey, vars?: Vars): string {
  const template = pick(catalogue[key], key, vars)
  return template.replace(/\{(\w+)\}/g, (marker, name: string) => {
    const value = vars?.[name]
    if (value === undefined) {
      if (import.meta.env.PROD) return marker
      throw new Error(`i18n: "${key}" needs the variable "${name}"`)
    }
    return String(value)
  })
}

/** "Luca", "Luca e Paolo", "Luca, Paolo e Marta". */
export function joinList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0] as string
  const head = items.slice(0, -1).join(t('list.separator'))
  return t('list.last', { head, last: items[items.length - 1] as string })
}

/** A small number as a word ("tre"), a larger one in digits. */
export function numberWord(n: number): string {
  const key = `number.${n}`
  return key in catalogue ? t(key as MessageKey) : String(n)
}

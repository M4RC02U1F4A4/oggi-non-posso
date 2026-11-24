import { Fragment, createElement, type ReactNode } from 'react'
import { it, type Message } from './it'

export type MessageKey = keyof typeof it
export type Vars = Record<string, string | number>

const catalogue: Record<MessageKey, Message> = it

function pick(message: Message, key: string, vars: { count?: unknown } | undefined): string {
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

/**
 * Like `t`, for a text whose variables are elements: a name in a `<bdi>`,
 * so that a name written right to left does not reorder the words around it.
 */
export function tNodes(key: MessageKey, vars: Record<string, ReactNode>): ReactNode {
  const template = pick(catalogue[key], key, vars)
  const parts: ReactNode[] = []
  let from = 0
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const [marker, name] = match as unknown as [string, string]
    parts.push(template.slice(from, match.index))
    const value = vars[name]
    if (value === undefined) {
      if (!import.meta.env.PROD) throw new Error(`i18n: "${key}" needs the variable "${name}"`)
      parts.push(marker)
    } else {
      parts.push(value)
    }
    from = match.index + marker.length
  }
  parts.push(template.slice(from))
  return createElement(Fragment, null, ...parts)
}

/** A name or a title among other words: isolated, whatever its direction. */
export function isolate(text: string): ReactNode {
  return createElement('bdi', null, text)
}

/** `joinList` for elements: "Luca e Paolo" with each name kept apart. */
export function joinNodes(items: ReactNode[]): ReactNode {
  if (items.length <= 1) return items[0] ?? ''
  const head: ReactNode[] = []
  items.slice(0, -1).forEach((item, index) => {
    if (index > 0) head.push(t('list.separator'))
    head.push(item)
  })
  return tNodes('list.last', { head: createElement(Fragment, null, ...head), last: items[items.length - 1] })
}

/** Names one after another, with only the separator between them. */
export function listNodes(items: ReactNode[]): ReactNode {
  const parts: ReactNode[] = []
  items.forEach((item, index) => {
    if (index > 0) parts.push(t('list.separator'))
    parts.push(item)
  })
  return createElement(Fragment, null, ...parts)
}

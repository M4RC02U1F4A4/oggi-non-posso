import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { isolate, joinList, joinNodes, listNodes, numberWord, t, tNodes } from './index'

describe('t', () => {
  it('returns the text of a key', () => {
    expect(t('slot.long.after_dinner')).toBe('Dopocena')
  })

  it('fills in variables', () => {
    expect(t('bar.closedBy', { name: 'Giulia' })).toBe('chiusa da Giulia')
  })

  it('chooses the plural form by count', () => {
    expect(t('people.slots', { count: 0 })).toBe('nessuna fascia')
    expect(t('people.slots', { count: 1 })).toBe('1 fascia')
    expect(t('people.slots', { count: 7 })).toBe('7 fasce')
    expect(t('people.title', { count: 1 })).toBe('Ha segnato una persona')
    expect(t('people.title', { count: 5 })).toBe('Hanno segnato in 5')
  })

  it('uses the other form for zero when there is no zero form', () => {
    expect(t('people.title', { count: 0 })).toBe('Hanno segnato in 0')
  })

  it('throws on a missing variable', () => {
    expect(() => t('bar.closedBy')).toThrow(/name/)
    expect(() => t('bar.closedBy', { nome: 'Giulia' })).toThrow(/name/)
  })

  it('throws when plural forms get no count', () => {
    expect(() => t('people.slots')).toThrow(/count/)
  })
})

describe('joinList', () => {
  it('joins names the way a sentence does', () => {
    expect(joinList([])).toBe('')
    expect(joinList(['Luca'])).toBe('Luca')
    expect(joinList(['Luca', 'Paolo'])).toBe('Luca e Paolo')
    expect(joinList(['Luca', 'Paolo', 'Marta'])).toBe('Luca, Paolo e Marta')
  })
})

describe('numberWord', () => {
  it('writes small numbers as words', () => {
    expect(numberWord(3)).toBe('tre')
    expect(numberWord(10)).toBe('dieci')
    expect(numberWord(11)).toBe('11')
  })
})

describe('tNodes', () => {
  const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node)

  it('fills in elements, and chooses the plural form by count', () => {
    expect(html(tNodes('bar.closedBy', { name: isolate('Giulia') }))).toBe('chiusa da <bdi>Giulia</bdi>')
    expect(html(tNodes('peek.missing', { count: 2, names: joinNodes(['Luca', 'Marta'].map(isolate)) }))).toBe(
      'Non possono <bdi>Luca</bdi> e <bdi>Marta</bdi>',
    )
  })

  it('joins names as joinList does', () => {
    expect(html(joinNodes(['Luca', 'Marta', 'Paolo'].map(isolate)))).toBe(
      '<bdi>Luca</bdi>, <bdi>Marta</bdi> e <bdi>Paolo</bdi>',
    )
    expect(html(joinNodes([isolate('Luca')]))).toBe('<bdi>Luca</bdi>')
    expect(html(listNodes(['Luca', 'Marta'].map(isolate)))).toBe('<bdi>Luca</bdi>, <bdi>Marta</bdi>')
  })

  it('throws on a missing variable', () => {
    expect(() => tNodes('bar.closedBy', {})).toThrow(/name/)
  })
})

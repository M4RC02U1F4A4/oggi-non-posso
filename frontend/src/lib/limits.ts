// The limits of the API, checked before asking so the answer comes at once.
// The backend counts characters, not bytes or UTF-16 units; so does this.

export const MAX_TITLE_LENGTH = 80
export const MAX_NAME_LENGTH = 30
export const MAX_DAYS = 62

export function countCharacters(text: string): number {
  return [...text].length
}

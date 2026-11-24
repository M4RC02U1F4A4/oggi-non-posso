// Event ids and organiser keys are random UUIDs, lower case, in the
// canonical 36-character form. Anything else in their place is not one, and
// is not worth a request.

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && CANONICAL_UUID.test(value)
}

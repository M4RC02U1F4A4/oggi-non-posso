import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom lays nothing out, so it has no scrolling to do.
Element.prototype.scrollIntoView = () => {}
window.scrollTo = () => {}

afterEach(() => {
  cleanup()
})

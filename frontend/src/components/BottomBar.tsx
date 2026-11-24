import type { ReactNode } from 'react'
import '../styles/BottomBar.css'

/** The bar fixed at the bottom of the phone layout. Give the page `page--bar`. */
export function BottomBar({ children }: { children: ReactNode }) {
  return <div className="bar only-narrow">{children}</div>
}

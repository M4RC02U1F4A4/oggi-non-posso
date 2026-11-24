import { Route, Routes } from 'react-router'
import { t } from './i18n'

// The pages arrive with the tasks that build them; until then every
// address answers with the name of the product.
function Placeholder() {
  return (
    <main className="wrap">
      <h1>{t('app.title')}</h1>
    </main>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<Placeholder />} />
    </Routes>
  )
}

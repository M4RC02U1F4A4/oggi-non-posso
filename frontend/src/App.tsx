import { Route, Routes } from 'react-router'
import { CreatePage } from './pages/CreatePage'
import { EventPage } from './pages/EventPage'
import { NotFoundPage } from './pages/NotFoundPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<CreatePage />} />
      <Route path="/e/:id" element={<EventPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

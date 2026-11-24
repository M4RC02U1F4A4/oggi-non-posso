import { Route, Routes } from 'react-router'
import { CreatePage } from './pages/CreatePage'
import { EventPage } from './pages/EventPage'
import { NotFoundPage } from './pages/NotFoundPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<CreatePage />} />
      {/* The organiser link is the same page: it reads the key and moves to /e/:id. */}
      <Route path="/e/:id" element={<EventPage />}>
        <Route path="o/:key" element={null} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

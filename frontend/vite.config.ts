import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// The only default of the frontend's configuration: where the dev server
// sends /api when VITE_API_TARGET is not set.
const DEFAULT_API_TARGET = 'http://localhost:8080'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': env.VITE_API_TARGET || DEFAULT_API_TARGET,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})

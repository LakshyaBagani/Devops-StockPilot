import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Same-origin /api in every environment. API_PROXY_TARGET points dev at another API,
// e.g. a kubectl port-forward on :18000.
const apiProxy = { '/api': process.env.API_PROXY_TARGET || 'http://localhost:8000' }

// VITE_GIT_SHA needs no define: Vite exposes VITE_* variables from the build environment.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: { port: 5173, strictPort: true, proxy: apiProxy },
  preview: { port: 4173, strictPort: true, proxy: apiProxy },
  build: { sourcemap: false },
})

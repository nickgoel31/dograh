import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // Served from the site root by default; the production build under a path uses VITE_BASE=/new/.
    base: env.VITE_BASE || '/',
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    // Same-origin in dev so the session cookie works without CORS setup.
    server: { proxy: { '/api': { target: env.VITE_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true } } },
  }
})

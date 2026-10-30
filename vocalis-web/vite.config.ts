import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    // Same-origin in dev so the session cookie works without CORS setup.
    server: { proxy: { '/api': { target: env.VITE_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true } } },
  }
})

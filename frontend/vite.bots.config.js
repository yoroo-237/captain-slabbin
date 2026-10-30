import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The bots dashboard (bots platform): its own page in bots/, served by the bots
// platform's API server from dist-bots. Same code base as the site's admin.
export default defineConfig({
  root: 'bots',
  plugins: [react()],
  define: { 'import.meta.env.VITE_PLATFORM': JSON.stringify('bots') },
  build: { outDir: '../dist-bots', emptyOutDir: true },
  // Dev: the API sees same-origin calls, as in production
  server: { port: 5176, proxy: { '/api': { target: 'http://localhost:4000', configure: proxy => proxy.on('proxyReq', req => req.removeHeader('origin')) } } },
})

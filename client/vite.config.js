import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        // npm run dev passes API_PORT from the server's own PORT. The fallback
        // deliberately is not 5000: macOS holds that for AirPlay Receiver, which
        // answers every proxied call with a bare 403.
        target: `http://127.0.0.1:${process.env.API_PORT || 5050}`,
        changeOrigin: true,
      },
    },
  },
});

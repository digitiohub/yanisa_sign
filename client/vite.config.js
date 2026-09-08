import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        // macOS holds port 5000 for AirPlay Receiver, so allow an override.
        target: `http://127.0.0.1:${process.env.API_PORT || 5000}`,
        changeOrigin: true,
      },
    },
  },
});

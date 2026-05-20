import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://solar-power-eta.vercel.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});

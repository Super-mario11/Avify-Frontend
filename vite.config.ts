import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      os: path.resolve(__dirname, 'src/shims/os.ts')
    }
  },
  server: {
    port: 4200
  }
});

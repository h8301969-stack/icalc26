/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import net from 'net';

const allowedPorts = [3000, 3002, 3003, 3004, 3005];

async function getAvailablePort(ports: number[]) {
  for (const port of ports) {
    const isAvailable = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
    if (isAvailable) return port;
  }
  return ports[0];
}

export default defineConfig(async () => {
    await getAvailablePort(allowedPorts);
    return {
      server: {
        port:5173,
        strictPort: true,
        host: '127.0.0.1',
      },
      plugins: [react()],
      // No env injection needed — all features are client-side only.
      // (Previously contained GEMINI_API_KEY wiring; removed during production cleanup.)
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      test: {
        environment: 'node',
        include: ['utils/**/*.test.ts'],
      },
    };
});

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
        port: 5173,
        strictPort: true,
        // localhost HTTP is a secure context for Web Bluetooth; use https in production.
        host: true,
      },
      plugins: [react()],
      // Bake ordered release tag + CI build into the client (not package.json jumps).
      envPrefix: ['VITE_'],
      define: {
        'import.meta.env.VITE_APP_BUILD': JSON.stringify(
          String(process.env.VITE_APP_BUILD || process.env.GITHUB_RUN_NUMBER || '0')
        ),
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(
          String(process.env.VITE_APP_VERSION || '0.0.1')
        ),
      },
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

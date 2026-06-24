import path from 'path';
import { defineConfig, loadEnv } from 'vite';
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
      server.listen(port, '0.0.0.0');
    });
    if (isAvailable) return port;
  }
  return ports[0];
}

export default defineConfig(async ({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const port = await getAvailablePort(allowedPorts);
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
      }
    };
});

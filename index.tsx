import React from 'react';
import ReactDOM from 'react-dom/client';
/* Montserrat (dynamic) for UI, numbers, and brand */
import '@fontsource/montserrat/latin-300.css';
import '@fontsource/montserrat/latin-300-italic.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/montserrat/latin-700-italic.css';
import '@fontsource/montserrat/latin-800.css';
import '@fontsource/montserrat/latin-900.css';
import App from './App';
import './index.css';
import { nativeWarmupBle } from './utils/nativeBle';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Warm BLE permissions/adapter on native so printer connect is ready sooner
void nativeWarmupBle();

// Capacitor wraps the native app — not a PWA. Unregister any leftover service workers
// from older builds so browser caches do not serve stale shells.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister();
  });
  if ('caches' in window) {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
}

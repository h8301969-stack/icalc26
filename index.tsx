import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

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

// Register service worker only in production to avoid caching during development
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', import.meta.url))
      .then(reg => console.log('iCalc SW registered. Scope:', reg.scope))
      .catch(err => console.warn('iCalc SW registration failed:', err));
  });
} else {
  // Helpful log during dev
  console.log('Skipping service worker registration in development');
}
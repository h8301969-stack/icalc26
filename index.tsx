import React from 'react';
import ReactDOM from 'react-dom/client';
/* Montserrat for numbers/brand; Candara for body/UI text */
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
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('iCalc SW registered. Scope:', reg.scope))
      .catch(err => console.warn('iCalc SW registration failed:', err));
  });
} else {
  // Helpful log during dev
  console.log('Skipping service worker registration in development');
}

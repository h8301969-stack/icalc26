# iCalc 26 — Glassmorphic Production Calculator

A modern, accessible, PWA-ready calculator with a premium glassmorphic UI, full operator precedence math engine, POS inventory dashboard, history, settings, and keyboard support.

## Features
- **Production-grade math engine**: Full precedence (`2+3*4=14`), parentheses, decimals, modulo, iOS symbols (× ÷), unary minus/negatives, and safe error handling.
- **81 passing tests** covering operations, precedence, parentheses, decimals, edge cases, negatives, safe evaluation, and real-world scenarios.
- **Glassmorphic UI** with live wallpaper backgrounds, accent theming, light/dark modes, and smooth animations.
- **POS Dashboard**: Inventory management, restocking, sales logging, transaction archive, filters, and search.
- **History & Settings panels**: Persistent history, custom wallpapers, curated gallery, UI scale, and appearance controls.
- **Accessibility**: ARIA roles/labels, keyboard navigation (numbers, operators, Enter, Backspace, Escape), focus management, and Escape-to-close on all modals.
- **PWA support**: Installable, offline-capable via service worker, with install prompt.
- **+/- toggle**, percent, and running live preview (safe evaluation).
- **Error boundary** and graceful fallbacks for calculation errors.

## Run Locally

**Prerequisites:** Node.js (v18+ recommended)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```
   The app runs on port 5173 at `127.0.0.1`.

3. Run the test suite:
   ```bash
   npm test
   ```
   Watch mode: `npm run test:watch`

4. Lint:
   ```bash
   npm run lint
   ```

5. Build for production:
   ```bash
   npm run build
   ```
   Then serve the `dist/` folder with any static host.

## PWA & Installation
- The app registers a service worker (`sw.js`) for offline caching of the app shell and hashed build assets.
- On supported browsers (Chrome/Edge on desktop or Android), an install prompt appears after interaction.
- Add to Home Screen on iOS via Safari's share sheet for a native-like experience.

## Project Structure (Key Files)
- `App.tsx` — Main orchestrator (state, keyboard, panels, live preview).
- `utils/calculator.ts` — Tokenizer + recursive-descent Parser + `safeEvaluate`.
- `utils/calculator.test.ts` — 81 comprehensive Vitest tests.
- `components/` — `CalcButton`, `HistoryPanel`, `SettingsPanel`, `POSDashboard`, `ErrorBoundary`, etc.
- `hooks/` — `useCalculator`, `useHistory`, `usePOS`, `useSettings`, `useInvoice`, and shared `storage`.
- `constants.tsx` — Icons, themes, wallpaper slides.
- `sw.js`, `manifest.json` — PWA assets.
- `vite.config.ts` — Dev server, React plugin, and Vitest config.

## Production Notes
- All math is pure client-side with deterministic results and explicit error types (`CalculationError`).
- Persistent state uses `localStorage` (history, settings, POS inventory/purchases).
- Wallpaper backgrounds use bundled local assets for full offline support.

## License
MIT (or your preferred license). Built for reliability, accessibility, and delight.
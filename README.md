

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
   The app auto-selects an available port from [3000, 3002–3005] and opens on `0.0.0.0`.

3. Run the test suite (manual runner, no Jest required):
   ```bash
   npm test
   ```
   Or directly:
   ```bash
   npx --yes tsx utils/calculator.test.ts
   ```

4. Build for production:
   ```bash
   npm run build
   ```
   Then serve the `dist/` folder with any static host.

## PWA & Installation
- The app registers a service worker (`sw.js`) for offline caching of core assets.
- On supported browsers (Chrome/Edge on desktop or Android), an install prompt appears after interaction.
- Add to Home Screen on iOS via Safari's share sheet for a native-like experience.

## Project Structure (Key Files)
- `App.tsx` — Main orchestrator (state, keyboard, panels, live preview).
- `utils/calculator.ts` — Tokenizer + recursive-descent Parser + `safeEvaluate`.
- `utils/calculator.test.ts` — 81 comprehensive tests.
- `components/` — `CalcButton`, `HistoryPanel`, `SettingsPanel`, `POSDashboard`, `ErrorBoundary`, etc.
- `constants.tsx` — Icons, themes, wallpaper slides.
- `sw.js`, `manifest.json` — PWA assets.
- `vite.config.ts` — Custom port selection + React plugin.

## Legacy / Deprecated Files
- `Calc.tsx` — Legacy component (no longer imported; kept for reference only).
- `geminiService.ts` — Previously used for AI features; fully removed from active code.

## Production Notes
- No external AI or PDF dependencies remain.
- All math is pure client-side with deterministic results and explicit error types (`CalculationError`).
- Persistent state uses `localStorage` (history, settings, POS inventory/purchases).
- External wallpaper images are loaded from Unsplash (CDN) — consider self-hosting for fully offline/air-gapped deployments.

## License
MIT (or your preferred license). Built for reliability, accessibility, and delight.

# Kimi Code Context — iCalc 26

## Project Overview

iCalc 26 is a production-grade, PWA-ready calculator with a premium glassmorphic iOS-style UI. It includes a full math engine, POS inventory dashboard, invoice system, history/settings panels, Bluetooth/USB receipt printing, and cloud sync via Supabase. The app is built as a single-page React application using Vite.

## Tech Stack

- **Framework**: React 19 + TypeScript (~5.8) + Vite 6
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`), custom CSS variables for glassmorphism
- **State**: Local React state + custom hooks; persistence via `localStorage`
- **Backend/Auth**: Supabase (supabase-js) for auth, profiles, and optional cloud data sync
- **Math**: Custom recursive-descent parser + `fraction.js` for precision
- **Testing**: Vitest (tests in `utils/**/*.test.ts`, runs in Node environment)
- **PWA**: Service worker (`sw.js`), `manifest.json`, offline support

## Directory Structure

```
components/          # React components (TSX), all PascalCase
hooks/               # Custom hooks, all camelCase with `use` prefix
utils/               # Pure utilities, math engine, formatters, tests
constants.tsx        # Shared icons (SVG components), themes, wallpaper exports
types.ts             # Shared TypeScript interfaces/types
supabase/            # SQL schema, edge functions, migrations
public/              # Static PWA assets (icons, manifest, sw.js)
dist/                # Production build output
```

## Coding Conventions

### General
- Use **TypeScript strict mode** patterns; explicit return types on exported utilities.
- Prefer **functional components** with hooks; no class components except `ErrorBoundary`.
- Use `React.FC` sparingly; plain function components are fine.
- File naming: Components are `PascalCase.tsx`, hooks are `camelCase.ts`, utilities are `camelCase.ts`.
- CRLF line endings are present in many files; preserve them when editing existing files.

### State & Hooks
- Complex state is encapsulated in custom hooks (`useCalculator`, `useHistory`, `usePOS`, `useInvoice`, `useSettings`, `useAuth`).
- Hooks accept callbacks (e.g., `onEvaluate`, `triggerHaptic`) rather than importing UI concerns.
- `localStorage` persistence lives in `hooks/storage.ts` and is wrapped with try/catch and JSON parsing.
- Use `useCallback`/`useMemo` for stable references passed to child components or effect deps.

### Component Patterns
- UI is **glassmorphic**: use `backdrop-blur`, semi-transparent backgrounds (`bg-white/10`, `bg-white/40`), and soft shadows.
- Support **light/dark mode** via an `isLight` boolean; always provide both color variants.
- Use Tailwind arbitrary values for fine-tuned sizing (e.g., `max-w-[430px]`, `rounded-[26px]`).
- Accessibility: `aria-label`, `role`, `aria-live`, keyboard handlers (`Escape` to close modals), and focus management are required.
- Icons are inline SVG components exported from `constants.tsx` as `Icons.*`.

### Math Engine
- `utils/calculator.ts` is the source of truth for all evaluation.
- `evaluateExpression` uses recursive-descent parsing with `fraction.js` for exact arithmetic.
- `safeEvaluate` wraps evaluation and returns formatted strings; never use `eval()` or `Function()`.
- POS expressions (inventory items with names/prices) are handled by `utils/posExpression.ts` and converted to evaluable math before parsing.

## Key Utilities

| File | Purpose |
|------|---------|
| `utils/calculator.ts` | Tokenizer, parser, `safeEvaluate`, `CalculationError` |
| `utils/posExpression.ts` | POS-style expression formatting and evaluation |
| `utils/expressionDisplay.ts` | Expression slicing for cursor rendering, unidentified price highlighting |
| `utils/expressionLayout.ts` | Auto/preset layout for expression display (portrait/landscape) |
| `utils/expressionCursor.ts` | Pointer-to-cursor mapping, scroll-into-view |
| `utils/auth.ts` | Local auth helpers, profile management, admin checks |
| `utils/bluetoothPrinter.ts` | Web Bluetooth receipt printing |
| `utils/receiptCanvas.ts` | Canvas-based receipt generation for sharing/printing |

## Styling Rules

- Tailwind v4 is used with PostCSS (`postcss.config.js`).
- Glass blur variable: `backdrop-blur-(--glass-blur,24px)`.
- Safe area insets: use `env(safe-area-inset-*)` for mobile padding.
- Landscape mode is supported via a `layoutMode` setting and `useScreenOrientation`.
- Disable-card mode (`settings.disableCalculatorCard`) removes rounded borders and background for a transparent, edge-to-edge look.

## Testing

- Run tests: `npm test`
- Watch mode: `npm run test:watch`
- Tests live alongside utilities: `utils/calculator.test.ts`.
- Use Vitest; test environment is `node`.

## Auth & Profiles

- Auth overlay (`AuthOverlay`) supports signup, login, dev skip (dev only), and quick unlock.
- Profiles are stored in settings and synced with Supabase when online.
- `isAdminProfile` gates access to transactions, admin portal, and certain POS features.
- Password verification and change-password flows exist for admin operations.

## Data Sync

- `useSupabaseDataSync` syncs history, inventory, purchases, suppliers, requests, restocks, and invoice state when a cloud user logs in.
- Local data is authoritative when offline; cloud sync is opportunistic.
- `clearAppSessionData` resets all local state for a fresh session.

## Common Pitfalls

1. **Do not use `eval` or `new Function`** for math; always route through `safeEvaluate` or `evaluateExpression`.
2. **Preserve CRLF endings** when editing files that have them (check tool output for `\r`).
3. **Expression cursor state** (`cursorPos`) is managed in `useCalculator`; when setting expression externally, also update cursor position.
4. **POS expressions** are not plain math strings; they contain inventory names and prices. Convert with `cleanPosExpressionForEval` before evaluation.
5. **Currency formatting** is handled by `useSettings`'s `formatCurrency`; respect `settings.currency` and `settings.ghsCalculatorStyle`.
6. **Invoice state** is managed by `useInvoice`; hydration must go through `hydrateInvoiceState` and `onInvoiceHydrated` callbacks.
7. **Bluetooth printing** requires a secure context (HTTPS or localhost); the dev server uses `host: true` to support this.

## When Adding Features

- If adding a new settings option, add it to `useSettings`, persist it in `localStorage`, and expose it in `SettingsPanel`.
- If adding a new calculator feature, extend `useCalculator` and add tests in `utils/calculator.test.ts`.
- If adding POS/inventory features, use `usePOS` for inventory state and `useInvoice` for cart/invoice logic.
- If adding new icons, add them as inline SVG components in `constants.tsx` under `Icons`.
- If adding database fields, update `supabase/schema.sql` and the sync logic in `useSupabaseDataSync`.

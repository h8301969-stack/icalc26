/// <reference types="vite/client" />

/**
 * Vite client type references.
 * This augments ImportMeta with env, glob, etc. so that `import.meta.env.PROD`
 * and similar Vite-specific properties are recognized by TypeScript.
 *
 * Placed at project root because the source layout is flat (no src/ folder).
 */

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

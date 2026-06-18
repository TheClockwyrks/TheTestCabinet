/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default backend URL the console points at on first load (optional). */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

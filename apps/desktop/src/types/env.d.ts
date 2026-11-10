// / <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_LAST_FM_API_KEY: string;
  readonly MAIN_VITE_ENCRYPTION_SECRET: string;
  readonly MAIN_VITE_SENTRY_DSN: string;
  readonly MAIN_VITE_DISCORD_CLIENT_ID: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

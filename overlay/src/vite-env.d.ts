/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only flag enabling the in-game tier-card fixture mode (see src/dev/tierFixture.ts). */
  readonly MAYHEM_OVERLAY_TIER_FIXTURE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

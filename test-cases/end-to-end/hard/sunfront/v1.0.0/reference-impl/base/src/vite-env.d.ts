/// <reference types="vite/client" />

// Page-relative binary/data assets loaded at runtime via `fetch(new URL(...))`
// resolved against the seeded `public/assets/` tree. These declarations let the
// bundler's `?url` suffix type-check if a source module ever imports one directly;
// the game itself loads the rig/mesh/effect files by fetching page-relative URLs
// derived from `assets/models.json` (specs/assets.md — page-relative, no leading `/`).
declare module "*.glb?url" {
  const url: string;
  export default url;
}

declare module "*.json?url" {
  const url: string;
  export default url;
}

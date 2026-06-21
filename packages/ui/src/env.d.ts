// Ambient declarations so the package typechecks standalone (without Vite's
// `vite/client` types). Each consuming app's bundler resolves these imports for
// real; here we only need the shapes.

declare module "*.module.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.css";

// Image imports resolve to their emitted URL (e.g. the baked backdrop still).
declare module "*.jpg" {
  const src: string;
  export default src;
}

// Side-effect stylesheet imports (e.g. the app's global.scss).
declare module "*.scss";

// Vite `?raw` imports (e.g. the About pages' bundled Markdown).
declare module "*?raw" {
  const src: string;
  export default src;
}

// Vite `?url` imports resolve to the emitted asset's URL — used to ship the
// vendored Foray replay assets (the foray-core wasm and the sprite-sheet PNG)
// with the bundle, fetched at runtime by the replay player.
declare module "*?url" {
  const src: string;
  export default src;
}

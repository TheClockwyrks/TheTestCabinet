// SCAFFOLD PLACEHOLDER — validation/none/globalSetup.ts
//
// `validation/none/vitest.config.ts` names this module as the project's
// `globalSetup`, and the validator stage of the v3.0.0 rework writes it: it
// serves the build's `dist/` once and launches the one headless Chromium every
// suite in this project shares, then tears both down when the run is over.
//
// It THROWS, deliberately. Every engineless validator drives a real browser, so
// a project whose global setup had quietly done nothing would run every suite
// against no server at all.

export default function setup(): void {
  throw new Error(
    "Cascade v3.0.0: validation/none/globalSetup.ts is a scaffold stub",
  );
}

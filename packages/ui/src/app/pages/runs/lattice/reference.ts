// The Lattice case's REFERENCE playback set: the three scored factories, played
// through the authoritative engine rather than any submission's.
//
// A run's playback answers "what did this model's engine compute?" — it steps the
// run's own `engine.wasm`. This answers the question that comes before it: "what is
// the factory supposed to look like?" The test-case Reference tab plays these so a
// reader can see the case's target behaviour without waiting for a run, the way an
// end-to-end case's Reference tab embeds its authored build. The architecture doc
// reserved the reference engine for exactly this — "engine-independent example
// simulations of a case" (testing/performance/lattice/architecture.md ->
// "Browser visualization").
//
// Both halves ship with the UI bundle, vendored from the case's replay bundle by
// `scripts/vendor-lattice-assets.mjs` and byte-guarded by `renderer.vendor.test.ts`:
//
//   • the engine — `lattice-core.wasm`, the same authoritative simulation the CLI
//     and the validator ran, built with the playback ABI. It is already vendored for
//     the run player's renderer; this reuses it as the module to STEP.
//   • the scenarios — the scored `cases/*.json` with their timelines cut to a dense
//     2500-tick window (see the bundle's `gen-reference.mjs`). The layouts are the
//     scored ones verbatim; only the run length is shortened, because the reference
//     engine's playback driver emits a full canonical state every tick and a
//     360,000-tick trace does not fit a browser.
//
// They ship with the bundle rather than being fetched because the Reference tab is
// reachable with NO run at all (and on the static site, which has no backend to ask):
// a case's reference cannot be sourced from a run's artifacts.
//
// The window matches `lattice-sdk`'s `PLAYBACK_WINDOW_TICKS`, so the Reference tab
// and a run's Results tab show the same stretch of the same factory and the two are
// directly comparable. It is baked into the committed scenarios rather than named
// here — the player reads the length off the board it loads, and shows it as the
// `tick n / 2500` readout while playing.

// Vite resolves each of these to an emitted URL in every host build (web console,
// desktop, static site). Nothing downloads until a viewer actually launches a
// playback — these imports are URL strings, not payloads.
import engineWasmUrl from "./assets/lattice-core.wasm?url";
import referenceSmallUrl from "./assets/reference-small.json?url";
import referenceMediumUrl from "./assets/reference-medium.json?url";
import referenceLargeUrl from "./assets/reference-large.json?url";

/**
 * The authoritative engine the reference playbacks step: `lattice-core` compiled to
 * wasm with the playback ABI. The same module the renderer's own integration tests
 * drive, and byte-identical to the case bundle's.
 */
export const REFERENCE_ENGINE_URL: string = engineWasmUrl;

/** One reference factory, ready to launch. */
export interface ReferenceScenario {
  /** Stable key, also the scored scenario's stem. */
  slug: string;
  /** The factory's scale, as the manifest names it. */
  name: string;
  /** Grid dimensions, which pair with the name to identify the factory. */
  grid: { width: number; height: number };
  /** Loadable URL of the windowed scenario. */
  scenarioUrl: string;
}

/**
 * How a factory is named on screen — its scale and its grid, e.g. `Large — 72×40`.
 * Shared by the list and the player's own bar so a launched factory is labelled
 * with exactly the name that was clicked.
 */
export function referenceLabel(scenario: ReferenceScenario): string {
  return `${scenario.name} — ${scenario.grid.width}×${scenario.grid.height}`;
}

/**
 * The three scored factories, in the manifest's order — which is also their
 * progression: the small correctness confirmation, then the two main-bus factories
 * where efficiency decides the score.
 */
export const REFERENCE_SCENARIOS: ReferenceScenario[] = [
  {
    slug: "small",
    name: "Small",
    grid: { width: 24, height: 12 },
    scenarioUrl: referenceSmallUrl,
  },
  {
    slug: "medium",
    name: "Medium",
    grid: { width: 48, height: 32 },
    scenarioUrl: referenceMediumUrl,
  },
  {
    slug: "large",
    name: "Large",
    grid: { width: 72, height: 40 },
    scenarioUrl: referenceLargeUrl,
  },
];

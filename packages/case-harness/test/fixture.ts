// The case the package's own suite is a case of.
//
// Every check in the four repository cases' `harness.test.ts` files drives that
// case's REFERENCE IMPLEMENTATION, which is why those files could only ever pin
// the harness's behaviour down as far as the reference happened to exercise it —
// and why four copies of the same machinery drifted apart without anything
// failing. This suite drives a build written for the purpose instead
// (`test/build/index.html`): the smallest thing that conforms to what
// `specs/instrumentation.md` asks of an engineless build, whose every answer is
// known in advance. A check here can therefore say what the harness does rather
// than what some game does.
//
// It is a case in every sense the package cares about — it builds its kit through
// `createCaseHarness` from a `CaseConfig`, exactly as a real case's `harness.ts`
// does — so the kit's own binding is under test alongside everything it binds.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_REQUIRED_OPS,
  createCaseHarness,
  type Harness as BaseHarness,
} from "../src/index";

/** The logical drawing surface the fixture's coordinates are stated in. */
export const STAGE = { width: 200, height: 100 } as const;

/** The rate the fixture's suite steps at. */
export const TICK_HZ = 60;

/** Where the fixture sounds: every fourth tick of live play, and no other. */
export const CUE_EVERY = 4;

/** The landmark the fixture paints at a fixed logical point, as `[r, g, b, a]`. */
export const LANDMARK = { x: 105, y: 55, rgba: [255, 0, 0, 255] } as const;

/** Everything the fixture's debug surface is asked for. */
export const REQUIRED_OPS: readonly string[] = [
  ...BASE_REQUIRED_OPS,
  "advance",
  "startPlaying",
  "blip",
];

/** The version the fixture's surface reports. */
export const FIXTURE_DEBUG_VERSION = 3;

/** What the fixture reports about itself. */
export interface FixtureSnapshot {
  screen: string;
  auto: boolean;
  frames: number;
  seed: number | null;
  x: number;
  sounds: number;
  /** Ticks that ran with at least one key held, which is what a tap makes. */
  heldTicks: number;
  /** Presses latched in the DOM handler, the moment the event arrived. */
  clicks: number;
  /** Pointer edges a TICK consumed, the way a buffered input layer reads them. */
  taken: number;
  keys: string[];
  pointer: { x: number; y: number };
}

/** The operations the fixture's surface carries, past the required four. */
export interface FixtureDebug {
  setAutoStep(on: boolean): Promise<void>;
  reset(options?: { seed: number }): Promise<void>;
  startPlaying(): Promise<void>;
  blip(): Promise<void>;
  /** Ask for the looping bed, which starts a turn of the event loop later. */
  bed(): Promise<void>;
}

const kit = createCaseHarness<FixtureSnapshot, FixtureDebug>({
  slug: "case-harness",
  handle: "__fixture",
  requiredOps: REQUIRED_OPS,
  // The fixture's `advance` runs whole ticks of its own length, which is the
  // shape two of the four cases use.
  step: { kind: "count", op: "advance" },
  stage: STAGE,
  // The fixture binds no key, so any key is an inert one.
  arm: { kind: "key", code: "KeyZ" },
  tickHz: TICK_HZ,
  // From THIS module, which sits in the suite's own directory — never from the
  // package's. A produced output is addressed relative to it.
  projectRoot: dirname(fileURLToPath(import.meta.url)),
  readOpeningSnapshot: true,
});

export const {
  createHarness,
  captureReplay,
  captureStill,
  watchCues,
  fitViewport,
  failSurface,
  SURFACE_REQUIREMENT,
  seconds,
  ticksFor,
  TICK_MS,
} = kit;

export { kit };

/** The fixture's harness, under the name a case's suites would import. */
export type Harness = BaseHarness<FixtureSnapshot, FixtureDebug>;

/* ---- Two more of the same case, each turning one option on ----------------- */
//
// Both build the SAME fixture build through `createCaseHarness`, differing only
// in the one config member under test, so what a check sees is that member's
// doing and nothing else.

/**
 * The fixture again, with `measureText` on.
 *
 * Its own kit rather than the one above, because measuring costs a crossing into
 * the page per frame read, and every other check in this suite reads frames
 * without needing a width.
 */
const measuringKit = createCaseHarness<FixtureSnapshot, FixtureDebug>({
  slug: "case-harness",
  handle: "__fixture",
  requiredOps: REQUIRED_OPS,
  step: { kind: "count", op: "advance" },
  stage: STAGE,
  arm: { kind: "key", code: "KeyZ" },
  tickHz: TICK_HZ,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
  measureText: true,
});

/** Open a fixture page whose frames carry a measured width per text call. */
export const createMeasuringHarness = measuringKit.createHarness;

/** What the projection below does to a snapshot, so a check can state it once. */
export function shout(snapshot: FixtureSnapshot): FixtureSnapshot {
  return { ...snapshot, screen: snapshot.screen.toUpperCase() };
}

/**
 * The fixture again, narrowing every snapshot on its way out of the page.
 *
 * A case's own projection reads fields this package never interprets, so what is
 * under test here is only WHERE it runs: at every point a snapshot crosses back
 * out, and nowhere else. Upper-casing `screen` is a projection whose having run
 * is visible in one field.
 */
const projectingKit = createCaseHarness<FixtureSnapshot, FixtureDebug>({
  slug: "case-harness",
  handle: "__fixture",
  requiredOps: REQUIRED_OPS,
  step: { kind: "count", op: "advance" },
  stage: STAGE,
  arm: { kind: "key", code: "KeyZ" },
  tickHz: TICK_HZ,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
  readOpeningSnapshot: true,
  projectSnapshot: shout,
});

/** Open a fixture page whose every snapshot arrives projected. */
export const createProjectingHarness = projectingKit.createHarness;

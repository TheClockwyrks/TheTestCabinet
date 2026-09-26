// The case the package's own suite is a case of.
//
// Each of the four repository cases once carried a self-check suite of its own,
// and every check in one drove that case's REFERENCE IMPLEMENTATION, which is why
// they could only ever pin the harness's behaviour down as far as the reference
// happened to exercise it — and why four copies of the same machinery drifted
// apart without anything failing. Those suites are gone. This one drives a build
// written for the purpose instead
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
export const FIXTURE_DEBUG_VERSION = 4;

/**
 * The fixture's SECONDS-FRAMES step operation, which the default kit does not use.
 *
 * The fixture's own `advance(count)` runs whole ticks of its own length, which is
 * the shape two of the four cases fix; `advanceSpan(seconds, frames)` is the
 * other, and it RECORDS the call it was made with. That recording is the only way
 * a check can see who divided an interval, which is the whole subject of
 * `Harness.advanceSeconds`.
 */
export const SPAN_OP = "advanceSpan";

/**
 * The operations a VARIANT of the fixture declares, which the build is not
 * faulted for missing.
 *
 * `bed` the fixture carries; `setCharge` it does not — one page therefore holds
 * both halves of what `CaseConfig.optionalOps` promises, and a check can read the
 * carried one and be refused the absent one without opening a second build.
 */
export const OPTIONAL_OPS = ["bed", "setCharge"] as const;

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
  /** Every `advanceSpan` the build received, as `[seconds, frames]`, in order. */
  spans: [number, number][];
}

/** The operations the fixture's surface carries, past the required four. */
export interface FixtureDebug {
  setAutoStep(on: boolean): Promise<void>;
  reset(options?: { seed: number }): Promise<void>;
  startPlaying(): Promise<void>;
  blip(): Promise<void>;
  /** Ask for the looping bed, which starts a turn of the event loop later. */
  bed(): Promise<void>;
  /** Put the moving landmark somewhere, so a batch of calls has an argument. */
  setX(value: number): Promise<void>;
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

/* ---- Three more of the same case, for the capabilities a variant needs ------ */
//
// Each is the SAME fixture build through `createCaseHarness`, differing in the
// one config member under test — so what a check sees is that member's doing and
// nothing else. They are separate kits rather than options on the one above for
// the same reason `measuringKit` is: what they turn on changes what every harness
// of that kit costs or carries, and every other check in this suite should be
// paying none of it.

/**
 * The fixture driven through its SECONDS-FRAMES step operation.
 *
 * The default kit steps this build with `advance(count)`; this one steps it with
 * `advanceSpan(seconds, frames)`, which is the shape `Harness.advanceSeconds`
 * and `Harness.skipSeconds` are the only callers of. Everything else about the
 * two kits is identical, so a check can put a driven frame and an undivided span
 * side by side against one build.
 */
const spanKit = createCaseHarness<FixtureSnapshot, FixtureDebug>({
  slug: "case-harness",
  handle: "__fixture",
  requiredOps: [...REQUIRED_OPS, SPAN_OP],
  step: { kind: "seconds-frames", op: SPAN_OP },
  stage: STAGE,
  arm: { kind: "key", code: "KeyZ" },
  tickHz: TICK_HZ,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

/** Open a fixture page whose step operation is told the length of the span. */
export const createSpanHarness = spanKit.createHarness;

/** The operations a variant of the fixture declares, past the ones it requires. */
export interface FixtureVariantDebug extends FixtureDebug {
  /**
   * Declared by the variant's specification, and carried by no build in this
   * package's fixture.
   *
   * Which is the point: a base build conforms perfectly without it, so the
   * surface probe may not fault one for missing it, and a check that reaches for
   * it anyway must be refused BY NAME rather than meeting a raw `TypeError` from
   * inside the page.
   */
  setCharge(value: number): Promise<void>;
}

/**
 * The fixture again, declaring the operations a variant of it adds.
 *
 * `bed` is one the build carries and `setCharge` one it does not, so a single
 * page answers both halves of what `optionalOps` promises.
 */
const variantKit = createCaseHarness<FixtureSnapshot, FixtureVariantDebug>({
  slug: "case-harness",
  handle: "__fixture",
  requiredOps: REQUIRED_OPS,
  optionalOps: [...OPTIONAL_OPS],
  step: { kind: "count", op: "advance" },
  stage: STAGE,
  arm: { kind: "key", code: "KeyZ" },
  tickHz: TICK_HZ,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

/** Open a fixture page whose case declares operations the build may not carry. */
export const createVariantHarness = variantKit.createHarness;

/** The variant's harness, as its own suites would import it. */
export type VariantHarness = BaseHarness<FixtureSnapshot, FixtureVariantDebug>;

/**
 * The fixture again, with a case script on either side of the harness's own.
 *
 * The two positions `browser.ts` injects a case's scripts at, exercised together
 * so that one reading says which ran where: `scripts/pre-init.js` before the
 * package's instrumentation and `scripts/post-init.js` after it. Both names are
 * resolved against `projectRoot`, which is this directory.
 */
const scriptedKit = createCaseHarness<FixtureSnapshot, FixtureDebug>({
  slug: "case-harness",
  handle: "__fixture",
  requiredOps: REQUIRED_OPS,
  step: { kind: "count", op: "advance" },
  stage: STAGE,
  arm: { kind: "key", code: "KeyZ" },
  tickHz: TICK_HZ,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
  preInitScripts: ["scripts/pre-init.js"],
  extraInitScripts: ["scripts/post-init.js"],
});

/** Open a fixture page carrying a case script on either side of the package's. */
export const createScriptedHarness = scriptedKit.createHarness;

// Arc Foundry — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own audio, its own asset loading, and its own
// `window.__foundry` — and the only place all of that exists is a page that has
// loaded the bundle. So the project serves `dist/`, loads it in Chromium, and
// reaches the game the way anything reaches it: over the surface the
// specification told the build to install.
//
// THE MACHINERY THAT DOES THAT IS NOT ARC FOUNDRY'S. Serving the build,
// connecting to the one browser, opening a page per harness, injecting the
// draw-command recorder and the counting audio probe, bracketing each driven
// frame around one `advance(dt, 1)` of the build's surface, reading pixels and
// draw calls back out, and writing the evidence a review point declares — every
// engineless case needs exactly that, and it lives once, in
// `@test-cabinet/case-harness`, staged beside this file as `./case-harness/`.
// What is left here is what is genuinely Arc Foundry's: the shape of its
// snapshot, the operations `specs/instrumentation.md` requires, the withholding
// of one produced file, the snapshot readers, and the compound sequences that
// pose an isolated yard.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Arc Foundry's names and Arc Foundry's types on it. The suites next door
// import `createHarness`, `captureReplay`, `openYard`, `parkUnit` and the rest
// from `../harness` without knowing which half of the machinery each belongs to.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/firing/in-range.test.ts` is the same path whichever runtime the
// run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__foundry`'s
// `snapshot`), the seven control and layout readings, the frames the harness
// itself drove, the operations the build issued against its 2D context, the
// pixels those operations left on the canvas, and the sounds the build emitted.
// Nothing here fabricates an outcome: the scenario helpers below only ARRANGE the
// yard through the surface, and the real update the build wrote is what runs from
// there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames of
// a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setCharge(500)` rather than
// `debug.setCharge(state, 500)`. The scenarios, the tolerances, and the assertions
// are the same ones, because they are the case's rather than the runtime's.
//
// AND THIS FILE OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design: one
// operation sets one field. Opening a run, emptying the yard, standing one
// structure up, releasing one held unit, pressing one named control — each of
// those is several operations in a fixed order, and each lives HERE so that a
// hundred suites say what their scenario is about in one line and say it the same
// way. A check that needs only part of a sequence calls the operations it needs.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import {
  createCaseHarness,
  type DrawCall,
  type Harness as BaseHarness,
  type HarnessOptions as BaseHarnessOptions,
  type Pixel,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { assertTruthy, fail } from "./assert";
import {
  type Action,
  BAR_H,
  BOARD_H,
  BOARD_W,
  BOARD_X,
  BOARD_Y,
  type ComboId,
  type ComponentType,
  DEFAULT_SEED,
  type DifficultyId,
  keyFor,
  type MapId,
  type MenuAction,
  PANEL_W,
  PANEL_X,
  type PanelAction,
  type Point,
  type PressAction,
  type Screen,
  type SpawnType,
  STAGE_H,
  STAGE_W,
  STAMPS_PER_LEVEL,
  type StatusAction,
  structureCenter,
  type Targeting,
  TARGETING_PRIORITIES,
  type Tier,
  tileCenter,
  UNBOUND_KEY,
} from "./constants";
import {
  HANDLE,
  REQUIRED_OPS,
  type DrivenFoundryDebugApi,
  type FoundrySnapshot,
  type MenuButton,
  type PanelButton,
  type PressButton,
  type ReadoutName,
  type RecipeEntry,
  type StatusControl,
  type StatusReadout,
  type StructureView,
  type UnitView,
} from "./surface";

export {
  HANDLE,
  REQUIRED_OPS,
  FOUNDRY_DEBUG_VERSION,
  type FoundrySnapshot,
  type IngredientState,
  type MenuButton,
  type PanelButton,
  type PressButton,
  type ReadoutName,
  type RecipeEntry,
  type StatusControl,
  type StatusReadout,
  type StructureView,
  type UnitView,
} from "./surface";

/* -------------------------------------------------------------------------- */
/* Withholding one produced file                                              */
/* -------------------------------------------------------------------------- */
//
// The one thing this project arranges on the PAGE rather than through the debug
// surface, which is why it is the case's own and why the shared harness takes it
// as a `beforeLoad` hook rather than owning it: a check that has to tell a played
// particle system apart from geometry the build draws in code gives the build
// everything it produced except one file, and that routing has to be in place
// before the bundle is ever fetched.

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** `assets/` at the root of the produced repository, as `specs/assets.md` fixes it. */
const PRODUCED_ASSETS = join(PROJECT_ROOT, "..", "assets");

/** What a build that never produced a file gets when it asks the site for one. */
const WITHHELD_BODY = "withheld";

/** The kinds of response a produced file can reach the page inside. */
const CARRIERS = /\.(?:js|mjs|css|html|json)$/;

/**
 * Keep the produced files named out of this page, whichever way the site carries
 * them.
 *
 * Two shapes, because a bundler chooses between them by size and the choice is not
 * the build's to make here:
 *
 * - **Its own file.** Answered `404`, exactly as the site answers a path the build
 *   never produced. Matched on the body rather than the URL, since the emitted name
 *   is a hash rather than the path the file was committed at.
 * - **Base64 inside another file.** The payload is swapped for bytes that will not
 *   parse as what the build asked for, which is what its loader would see from a
 *   file that did not arrive. The carrier itself still arrives, so nothing else in
 *   it is disturbed.
 *
 * Only the response kinds a produced file can be carried in are inspected, so the
 * sprites, the audio and the bundle's own requests are not copied through the host
 * for nothing.
 */
async function withholdProduced(
  page: Page,
  withhold: readonly string[],
): Promise<void> {
  if (withhold.length === 0) return;
  const files = withhold.map((path) =>
    readFileSync(join(PRODUCED_ASSETS, path)),
  );
  const inlined = files.map((file) => file.toString("base64"));
  const replacement = Buffer.from(WITHHELD_BODY).toString("base64");

  await page.route(
    (url) => CARRIERS.test(url.pathname),
    async (route) => {
      const response = await route.fetch();
      const body = Buffer.from(await response.body());
      if (files.some((file) => file.equals(body))) {
        await route.fulfill({ status: 404, body: WITHHELD_BODY });
        return;
      }
      let text = body.toString("utf8");
      let touched = false;
      for (const payload of inlined) {
        if (!text.includes(payload)) continue;
        text = text.split(payload).join(replacement);
        touched = true;
      }
      await route.fulfill({ response, body: touched ? text : body });
    },
  );
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in.
 *
 * The suite chooses the size of a frame, because the specification deliberately
 * fixes none: every rate in this game is per second and is integrated against the
 * elapsed time of the frame, so a build must reach the same place however that
 * time was divided. A steady 120 Hz makes every duration in this project a whole
 * number of frames — and keeps a projectile's step (`PROJECTILE_SPEED / 120`,
 * about 4.3 units) inside its own hit radius, so a shot's arrival is a fact about
 * the game rather than about the step size.
 */
const TICK_RATE = 120;

/**
 * The ground a replay is composited over when a frame paints no background.
 *
 * The near-black of a switchyard at night, so a recording of a scene the build
 * drew nothing behind reads as the yard rather than as a hole.
 */
export const REPLAY_BACKGROUND = "#05080c";

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears. A full-stack build decodes some
 * hundred produced sprites and a dozen sounds before it is ready, this project
 * holds eight pages of one browser open at once, and the host running it is
 * running a model's build under it — so the ceiling is set against a loaded
 * machine rather than an idle one, and a build that installed its surface from
 * its entry module pays none of it.
 */
const SURFACE_TIMEOUT_MS = 15_000;

/**
 * The shared harness, with Arc Foundry's snapshot, Arc Foundry's surface and Arc
 * Foundry's figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<FoundrySnapshot, DrivenFoundryDebugApi>({
  slug: "arc-foundry",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: whole frames covering a chosen span of simulated
  // time, so the suite's clock is what says how long a frame is. The package's
  // shared list of required operations stops short of naming the step operation,
  // and this case's `REQUIRED_OPS` in `surface.ts` is what a surface fault reports
  // against.
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_RATE,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a key delivered any other way would leave a perfectly good build silent.
  // `UNBOUND_KEY` is bound to nothing (specs/controls.md), so arming changes no
  // game state — and it is delivered before the opening `reset`, which restores
  // every declared field, so a check that asked for it starts where every other
  // check does.
  arm: { kind: "key", code: UNBOUND_KEY },
  // The seed the opening `reset` fixes, so a scenario driven from a fresh harness
  // is reproducible from that line on. `specs/instrumentation.md` defaults
  // `options.seed` to `DEFAULT_SEED` itself, and the harness passes it explicitly
  // so the call the build sees is the same one whether or not a check named a
  // seed of its own.
  defaultSeed: DEFAULT_SEED,
  replayBackground: REPLAY_BACKGROUND,
  surfaceTimeoutMs: SURFACE_TIMEOUT_MS,
  projectRoot: PROJECT_ROOT,
});

export const {
  captureReplay,
  captureStill,
  watchCues,
  fitViewport,
  failSurface,
  SURFACE_REQUIREMENT,
  TICK_HZ,
  TICK_MS,
  seconds,
  ticks,
  speedOverTicks,
} = kit;

/**
 * Everything a check reads off one page running this build.
 *
 * The shared harness's interface, bound to this case's snapshot and this case's
 * surface, plus the one drive this project states in SECONDS rather than in
 * frames — every duration `specs/enemies.md`, `specs/components.md` and
 * `specs/economy.md` fix is a span of simulated time, and a check that named its
 * own frame count for each would be restating the rate at every call site.
 */
type FoundryHarness = BaseHarness<FoundrySnapshot, DrivenFoundryDebugApi>;

export interface Harness extends FoundryHarness {
  /** Run whole frames of the default clock covering `s` seconds of game time. */
  advanceSeconds(s: number): Promise<void>;
}

/** How a harness opens its page, and what it steps in. */
export interface HarnessOptions extends BaseHarnessOptions {
  /**
   * Produced files this page is not given, named by the path `specs/assets.md`
   * fixes for each under `assets/` (`fx/aura.json`).
   *
   * WHY A CHECK WOULD WANT THIS. A produced particle system played at a place and a
   * shape the build draws in code at the same place look alike from outside, and
   * only the first stops when its file does not arrive. So a check that has to tell
   * them apart gives the build everything it produced except one file and reads the
   * same scene again.
   *
   * WHY IT IS MATCHED ON CONTENT RATHER THAN ON A URL. An engineless build bundles
   * its own files, and the bundler configuration is seeded rather than the build's
   * to write: a produced file leaves the build under a hashed name of the bundler's
   * choosing, and a small one leaves it carried inside another file as a base64
   * `data:` URI. Neither is the path the file was committed at, so the file is
   * recognised by its BYTES, read off disk here, in both of the shapes a site can
   * carry it in — see {@link withholdProduced}.
   *
   * WHAT IT CANNOT REACH, which every check built on it states in its own header: a
   * build that imports a produced file as a module carries it as parsed source, and
   * neither shape is on the wire. Such a build is out of this reading's reach, so a
   * withheld reading may only ever PASS one, never fail it.
   */
  withhold?: readonly string[];
}

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and no check but the
 * window-fit ones has to think about the fit at all.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const { withhold, ...rest } = options;
  const base = await kit.createHarness(
    withhold === undefined || withhold.length === 0
      ? rest
      : {
          ...rest,
          beforeLoad: (page: Page) => withholdProduced(page, withhold),
        },
  );
  return Object.assign(base, {
    advanceSeconds: (s: number): Promise<void> => base.advance(ticks(s)),
  });
}

/* ---- What the package brings, under this project's own names -------------- */
//
// Named one at a time rather than re-exported wholesale, so the list of what the
// suites next door may reach for is the list a reader can count.

export type {
  Clock,
  DrawCall,
  Pixel,
  Point as ReadPoint,
  RecordedFrame,
  RecordedOp,
  RecordedResource,
  RecordedState,
  Recording,
  Rgb,
  TimedCue,
  UntilOptions,
  Viewport,
} from "./case-harness/index";

export {
  callsTo,
  closeWorkerBrowser,
  colorDistance,
  ConstantClock,
  distance,
  drawnText,
  drewText,
  JitterClock,
  luminance,
  meanColor,
  retable,
  rgbOf,
  sampleColor,
  SequenceClock,
  setsOf,
  thinReplay,
  MAX_REPLAY_FRAMES,
} from "./case-harness/index";

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<FoundrySnapshot>;

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// A snapshot is a plain document, so these are pure functions over one. They
// exist so that a check reads what it is about by name and fails by assertion
// when the thing it named is not there, rather than dereferencing `undefined` a
// few lines later and reporting a `TypeError` where a verdict belonged.

/** The live unit that id, or a failure naming the id and what was on the yard. */
export function unitById(snapshot: FoundrySnapshot, id: number): UnitView {
  const found = snapshot.units.find((u) => u.id === id);
  assertTruthy(
    found,
    `snapshot().units to carry the unit #${id}; it carries ${
      snapshot.units.length === 0
        ? "none"
        : snapshot.units.map((u) => `#${u.id}`).join(", ")
    }`,
  );
  return found as UnitView;
}

/** The structure of that id, or a failure naming the id and what was on the yard. */
export function structureById(
  snapshot: FoundrySnapshot,
  id: number,
): StructureView {
  const found = snapshot.structures.find((s) => s.id === id);
  assertTruthy(
    found,
    `snapshot().structures to carry the structure #${id}; it carries ${
      snapshot.structures.length === 0
        ? "none"
        : snapshot.structures.map((s) => `#${s.id}`).join(", ")
    }`,
  );
  return found as StructureView;
}

/**
 * The last unit the snapshot reports, which `specs/instrumentation.md` fixes as
 * the one `spawnUnit` just released.
 */
export function lastUnit(snapshot: FoundrySnapshot): UnitView {
  const found = snapshot.units[snapshot.units.length - 1];
  assertTruthy(
    found,
    "snapshot().units to carry the unit spawnUnit just released, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as UnitView;
}

/**
 * The last structure the snapshot reports, which `specs/instrumentation.md` fixes
 * as the one the `place` operation just stood up.
 */
export function lastStructure(snapshot: FoundrySnapshot): StructureView {
  const found = snapshot.structures[snapshot.structures.length - 1];
  assertTruthy(
    found,
    "snapshot().structures to carry the structure just placed, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as StructureView;
}

/** The structure anchored at that tile, or `undefined`. */
export function structureAt(
  snapshot: FoundrySnapshot,
  col: number,
  row: number,
): StructureView | undefined {
  return snapshot.structures.find((s) => s.col === col && s.row === row);
}

/** Every structure that fires: the seven firing base types and the towers. */
export function firingStructures(snapshot: FoundrySnapshot): StructureView[] {
  return snapshot.structures.filter((s) => s.targeting !== null);
}

/**
 * The progress ordering of `specs/pathing.md`, furthest along the chain first.
 *
 * Compared first by the checkpoint the unit is heading for, and then, among units
 * heading for the same one, by the REMAINING route length to it — so a shorter
 * `progress` is further along. This is the ordering `first` and `last` select on,
 * and the tie-break every targeting priority resolves toward.
 */
export function compareAlongChain(a: UnitView, b: UnitView): number {
  if (a.waypointIndex !== b.waypointIndex)
    return b.waypointIndex - a.waypointIndex;
  return a.progress - b.progress;
}

/** The units of a snapshot, ordered furthest along the chain first. */
export function alongChain(snapshot: FoundrySnapshot): UnitView[] {
  return [...snapshot.units].sort(compareAlongChain);
}

/** The priority `steps` activations of the targeting control past `current`. */
export function targetingAfter(current: Targeting, steps: number): Targeting {
  const at = TARGETING_PRIORITIES.indexOf(current);
  assertTruthy(at >= 0, `a targeting priority; received ${String(current)}`);
  const n = TARGETING_PRIORITIES.length;
  return TARGETING_PRIORITIES[(at + (steps % n) + n) % n]!;
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic by design, so opening a run, emptying the yard, standing
// one structure up and releasing one held unit are each several operations in a
// fixed order. Every one of them lives here, so a suite says what its scenario is
// about in one line and every suite says it the same way. A check that needs only
// part of a sequence calls the operations it needs.
//
// Nothing here poses an outcome. Each of these arranges a precondition through
// the same systems play uses — a placed rock rolls through the real press, a
// released unit walks the real pathfinder — and what happens next comes from
// advancing the real simulation.

/** What a run opens as, and what the yard holds when it opens. */
export interface YardOptions {
  /** The map the run opens on. Defaults to the reset value, `substation`. */
  map?: MapId;
  /** The difficulty. Defaults to the reset value, `medium`. */
  difficulty?: DifficultyId;
  /** The seed every random draw runs off. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** The wave units released from now on scale to. */
  wave?: number;
  /** Charge in the bank. */
  charge?: number;
  /** Grid Integrity remaining. */
  integrity?: number;
  /** The refinement level, and with it the roll odds. */
  refinement?: number;
  /** The stamps left in the level's allowance. */
  stamps?: number;
  /** The speed multiplier. Defaults to the reset value, `1`. */
  speed?: number;
}

/**
 * A run at its first build phase, entered the way choosing a difficulty enters
 * one: reset to the title, choose the map and the difficulty, start the run.
 *
 * What it arranges is exactly the opening allocation `specs/campaign.md` states,
 * because `startRun` takes the path confirming the difficulty select takes.
 */
export async function openRun(
  h: Harness,
  options: YardOptions = {},
): Promise<void> {
  await h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  if (options.map !== undefined) await h.debug.setMap(options.map);
  if (options.difficulty !== undefined) {
    await h.debug.setDifficulty(options.difficulty);
  }
  await h.debug.startRun();
}

/**
 * Everything off the yard: every structure, every live unit, every projectile.
 *
 * The isolation the validator guide asks for, in one line. `clearStructures` also
 * clears the selection and the combine set and recomputes the route, and
 * `clearUnits` kills nothing and leaks nothing, so no bounty is paid and no Grid
 * Integrity is lost by emptying the yard.
 */
export async function emptyYard(h: Harness): Promise<void> {
  await h.debug.clearStructures();
  await h.debug.clearUnits();
  await h.debug.clearProjectiles();
}

/**
 * THE OPENING LINE OF ALMOST EVERY CHECK: a run on an empty yard, posed to the
 * resources and the progress the scenario needs.
 *
 * The order matters and is fixed here so no suite has to think about it: the run
 * opens first, because `startRun` installs the opening allocation over anything
 * posed before it, and the resources are posed after, because a check that wants
 * `500` Charge wants it whatever the run opened with.
 */
export async function openYard(
  h: Harness,
  options: YardOptions = {},
): Promise<void> {
  await openRun(h, options);
  await emptyYard(h);
  if (options.wave !== undefined) await h.debug.setWave(options.wave);
  if (options.charge !== undefined) await h.debug.setCharge(options.charge);
  if (options.integrity !== undefined) {
    await h.debug.setIntegrity(options.integrity);
  }
  if (options.refinement !== undefined) {
    await h.debug.setRefinement(options.refinement);
  }
  if (options.stamps !== undefined) await h.debug.setStamps(options.stamps);
  if (options.speed !== undefined) await h.debug.setSpeed(options.speed);
}

/**
 * Put away whatever is held on the cursor.
 *
 * `placeRock` goes through the real continuous-placement path, so it re-arms the
 * press the moment it lands and the panel then shows the held-rock read rather
 * than the inspector. A check that placed a rock and is about anything other than
 * the held rock puts it away first.
 *
 * THE ATOMIC POSE, NOT THE `back` KEY. `specs/instrumentation.md` carries
 * `clearHeld` for exactly this, and it is what a scenario reaches for: the `back`
 * action of `specs/controls.md` clears the hand too, but a check that routed
 * through it would fail on a build whose `back` binding is wrong, on every point
 * about the press, the combines, the panel and the campaign — defects belonging
 * to `input/back-held-rock` and `press/cancel-is-free` alone. Those two suites
 * press `back` themselves, because the control is what they are about.
 */
export async function clearHand(h: Harness): Promise<void> {
  await h.debug.clearHeld();
}

/** Refill the level's stamp allowance, for a scenario that needs a sixth rock. */
export async function refillStamps(h: Harness): Promise<void> {
  await h.debug.setStamps(STAMPS_PER_LEVEL);
}

/* ---- Standing one structure up -------------------------------------------- */
//
// Each of these stands exactly one thing on the yard and hands back its id, read
// off the snapshot's last entry as `specs/instrumentation.md` fixes it. Each
// asserts the placement landed, so a scenario that asked for an anchor the
// never-seal rule refuses fails where it asked rather than several frames later
// with a structure it never got.

/** A permanent firing component of that type and quality, at that anchor. */
export async function standComponent(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): Promise<number> {
  const before = (await h.snapshot()).structures.length;
  await h.debug.placeComponent(type, quality, col, row);
  return placed(
    await h.snapshot(),
    before,
    `placeComponent(${type}, ${quality}, ${col}, ${row})`,
  );
}

/** A combination tower at that anchor, landed at level `0` and raised to `level`. */
export async function standCombo(
  h: Harness,
  combo: ComboId,
  col: number,
  row: number,
  level = 0,
): Promise<number> {
  const before = (await h.snapshot()).structures.length;
  await h.debug.placeCombo(combo, col, row);
  const id = placed(
    await h.snapshot(),
    before,
    `placeCombo(${combo}, ${col}, ${row})`,
  );
  if (level !== 0) await h.debug.setComboLevel(id, level);
  return id;
}

/** An inert blocker at that anchor: a wall with no head and no glow. */
export async function standBlocker(
  h: Harness,
  col: number,
  row: number,
): Promise<number> {
  const before = (await h.snapshot()).structures.length;
  await h.debug.placeBlocker(col, row);
  return placed(await h.snapshot(), before, `placeBlocker(${col}, ${row})`);
}

/**
 * A candidate of a chosen type and quality, dropped through the real press.
 *
 * The roll is armed first, so the rock that lands rolls exactly what the scenario
 * asked for; the drop itself still goes through the placement path, so it spends
 * a stamp and is refused exactly where a pointer press would be. The hand is
 * cleared afterwards, because the press re-arms itself on a successful drop and a
 * held rock is what the panel shows instead of the inspector.
 */
export async function standCandidate(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): Promise<number> {
  const before = (await h.snapshot()).structures.length;
  await h.debug.setNextRoll(type, quality);
  await h.debug.placeRock(col, row);
  await h.debug.clearNextRoll();
  await clearHand(h);
  return placed(
    await h.snapshot(),
    before,
    `placeRock(${col}, ${row}) armed to roll ${type} at quality ${quality}`,
  );
}

/** The id the structure a `place` operation just appended carries. */
function placed(
  snapshot: FoundrySnapshot,
  before: number,
  what: string,
): number {
  assertTruthy(
    snapshot.structures.length === before + 1,
    `${what} to stand one structure up and append it to snapshot().structures ` +
      `(specs/instrumentation.md); the yard went from ${before} structures to ` +
      `${snapshot.structures.length}`,
  );
  return lastStructure(snapshot).id;
}

/** Select a structure, as a pointer press on it would. */
export async function selectStructure(h: Harness, id: number): Promise<void> {
  await h.debug.select(id);
}

/* ---- Releasing one unit --------------------------------------------------- */

/**
 * How a released unit is posed, one faculty at a time.
 *
 * Isolation reaches inside the entity: a check about a burn's damage wants a unit
 * that burns and does not walk, and a check about a slow's expiry wants one that
 * walks and carries a slow. So each faculty a scenario must hold is its own field
 * here, and every one it leaves out is left exactly as the spawner set it.
 */
export interface UnitPose {
  /** A logical position to stand it at. */
  at?: Point;
  /** Or the center of a tile to stand it at. */
  tile?: { col: number; row: number };
  /** The checkpoint it heads for, `1`–`7`, where `7` is the collector. */
  waypoint?: number;
  /** Its current health, at least `1` and at most its maximum. */
  hp?: number;
  /** A slow, applied through the rule `specs/enemies.md` fixes. */
  slow?: { amount: number; seconds: number };
  /** A burn, applied through the same rule, credited to no structure. */
  burn?: { dps: number; seconds: number };
  /** Travel held, and nothing else held with it. */
  frozen?: boolean;
}

/**
 * One unit of that type at the map's entry, scaled to the current wave, posed.
 *
 * `spawnUnit` releases through the real spawner and so puts the run into a live
 * wave whose spawn schedule is empty: the units on the yard are exactly the ones
 * released here and nothing else arrives. That wave clears the ordinary way, when
 * every one of them has died or leaked, and clearing it pays the ordinary
 * wave-clear bonus — so a check reading `charge` after a kill either holds the
 * resolution with {@link holdWaveOpen} or expects the bounty and the bonus.
 *
 * The poses are applied in the order `specs/instrumentation.md` leaves them
 * independent in: the checkpoint first, because setting it moves the unit
 * nowhere, then the position, then the health, then the statuses, and the travel
 * hold last so nothing after it has to think about whether the unit moved.
 */
export async function releaseUnit(
  h: Harness,
  type: SpawnType,
  pose: UnitPose = {},
): Promise<number> {
  const before = (await h.snapshot()).units.length;
  await h.debug.spawnUnit(type);
  const after = await h.snapshot();
  assertTruthy(
    after.units.length === before + 1,
    `spawnUnit(${type}) to release one unit and append it to snapshot().units ` +
      `(specs/instrumentation.md); the yard went from ${before} units to ` +
      `${after.units.length}`,
  );
  const id = lastUnit(after).id;

  if (pose.waypoint !== undefined) {
    await h.debug.setUnitWaypoint(id, pose.waypoint);
  }
  const at =
    pose.at ??
    (pose.tile === undefined
      ? undefined
      : tileCenter(pose.tile.col, pose.tile.row));
  if (at !== undefined) await h.debug.setUnitPosition(id, at.x, at.y);
  if (pose.hp !== undefined) await h.debug.setUnitHp(id, pose.hp);
  if (pose.slow !== undefined) {
    await h.debug.setUnitSlow(id, pose.slow.amount, pose.slow.seconds);
  }
  if (pose.burn !== undefined) {
    await h.debug.setUnitBurn(id, pose.burn.dps, pose.burn.seconds);
  }
  if (pose.frozen !== undefined) {
    await h.debug.setUnitFrozen(id, pose.frozen);
  }
  return id;
}

/**
 * One unit standing still at a chosen point, keeping every faculty but travel.
 *
 * The workhorse of this project. A held unit is targetable, it takes damage, its
 * burn ticks, its slow runs down and expires, and its body holds the position it
 * was posed at however long the scenario runs — so a check about damage, about a
 * status effect, or about which unit a priority picks reads a number that moved
 * for exactly one reason.
 */
export async function parkUnit(
  h: Harness,
  type: SpawnType,
  at: Point,
  pose: Omit<UnitPose, "at" | "tile" | "frozen"> = {},
): Promise<number> {
  return releaseUnit(h, type, { ...pose, at, frozen: true });
}

/**
 * Open a live wave and hold its clear-and-pay resolution, so nothing the check is
 * reading moves because the wave ended under it.
 *
 * Clearing a wave pays the wave-clear bonus and opens the next build phase, and a
 * bonus landing in the middle of a check that is reading `charge` would be
 * indistinguishable from the bounty it was measuring.
 *
 * A GATE ON THE RUN, NOT A BYSTANDER. `specs/instrumentation.md` carries
 * `setWaveHold` for exactly this, and `setPhase` for putting the run into the
 * phase without releasing anything. What this replaces is a Mote parked at the
 * map entry and frozen — an entity kept quiet by the build's own freeze and by
 * the test gun's range not reaching it, which is the containment the validator
 * guide rules out: a build with a leaky freeze would let it walk, leak and clear
 * the wave, and every scenario that staged it would report a defect belonging to
 * the freeze check. The gate holds one faculty and nothing else, so a scenario
 * holds only the units its requirement is about.
 */
export async function holdWaveOpen(h: Harness): Promise<void> {
  await h.debug.setPhase("wave");
  await h.debug.setWaveHold(true);
}

/**
 * Commit the level's harvest, which is what starts the wave.
 *
 * There is no send control (`specs/campaign.md`): a wave begins when a candidate
 * is kept, downgraded, or folded into a combine. So this stands one candidate at
 * the anchor given and keeps it, and the wave the level composed starts on the
 * next advance. The component it leaves standing is the one the harvest produced,
 * and its id comes back.
 */
export async function startWave(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): Promise<number> {
  const candidate = await standCandidate(h, type, quality, col, row);
  await h.debug.keep(candidate);
  return candidate;
}

/* ---- Controls ------------------------------------------------------------- */
//
// A control is found by the action it carries rather than by where it was drawn,
// because `specs/ui.md` fixes each menu's content and navigation and leaves its
// layout to the build. The rectangle a reading reports is the control's real hit
// region, so pressing the center of a reported, non-disabled rectangle activates
// it — which is how a check operates the game the way a player does without
// knowing anything about the build's layout.

/** A rectangle a reading reports. */
export interface ControlRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The center of a reported control rectangle. */
export function controlCenter(rect: ControlRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * A point on the stage inside none of `rects`.
 *
 * `specs/ui.md` gives an edge "outside every region" an outcome of its own, and
 * where a menu draws its entries is the build's, so a point outside every one of
 * them is SEARCHED FOR over the stage rather than named here: a build that draws
 * its menu somewhere else still has the point decided against its own layout. The
 * stage is walked on a coarse lattice, inset from the edges so the point is one a
 * player could really put a finger on, and the first square inside no reported
 * rectangle is taken.
 */
export function pointOutside(rects: readonly ControlRect[]): Point {
  const STEP = 20;
  const INSET = 10;
  for (let y = INSET; y <= STAGE_H - INSET; y += STEP) {
    for (let x = INSET; x <= STAGE_W - INSET; x += STEP) {
      const covered = rects.some(
        (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
      );
      if (!covered) return { x, y };
    }
  }
  return fail(
    "somewhere on the stage outside every reported menu rectangle",
    "every point covered by one",
  );
}

/** A press and a release at a logical point: one click. */
export async function clickAt(h: Harness, x: number, y: number): Promise<void> {
  await h.debug.pointerDown(x, y);
  await h.debug.pointerUp();
}

/**
 * Move the pointer onto a logical point, without pressing.
 *
 * `specs/controls.md` gives a bare move effects of its own — the menu highlight
 * follows it, the held footprint snaps under it — so a check about a hover delivers
 * the move alone and nothing else.
 */
export async function hoverAt(h: Harness, x: number, y: number): Promise<void> {
  await h.debug.pointerMove(x, y);
}

/** Move the pointer onto the center of a reported control rectangle. */
export function hoverControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return hoverAt(h, point.x, point.y);
}

/**
 * Press at one logical point and release at another.
 *
 * The gesture `specs/ui.md` takes no entry for: "Two edges in different regions take
 * no entry, and an edge outside every region takes none." `pointerUp` releases at
 * the position the pointer is at, so the release is placed by moving there first.
 */
export async function pointerDrag(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  await h.debug.pointerDown(from.x, from.y);
  await h.debug.pointerMove(to.x, to.y);
  await h.debug.pointerUp();
}

/** A touch contact landing and lifting at one logical point: a tap. */
export async function tapAt(h: Harness, x: number, y: number): Promise<void> {
  await h.debug.touchStart(x, y);
  await h.debug.touchEnd();
}

/** Tap the center of a reported control rectangle. */
export function tapControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return tapAt(h, point.x, point.y);
}

/**
 * Land a touch contact at one logical point and travel it to another, leaving it
 * down, so what the travel alone changes can be read before the lift.
 */
export async function touchOnto(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  await h.debug.touchStart(from.x, from.y);
  await h.debug.touchMove(to.x, to.y);
}

/** Land a contact at one logical point, travel it to another, and lift it there. */
export async function touchDrag(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  await touchOnto(h, from, to);
  await h.debug.touchEnd();
}

/** A click at the center of a tile. */
export async function clickTile(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const point = tileCenter(col, row);
  await clickAt(h, point.x, point.y);
}

/** A click at the center of a structure anchored at that tile. */
export async function clickStructure(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const point = structureCenter(col, row);
  await clickAt(h, point.x, point.y);
}

/** A click at the center of a reported control rectangle. */
export async function clickControl(
  h: Harness,
  rect: ControlRect,
): Promise<void> {
  const point = controlCenter(rect);
  await clickAt(h, point.x, point.y);
}

/** The inspector's control carrying that action, or a failure naming what was drawn. */
export async function panelControl(
  h: Harness,
  action: PanelAction,
  label?: string,
): Promise<PanelButton> {
  const drawn = await h.debug.panelButtons();
  const found = drawn.find(
    (b) => b.action === action && (label === undefined || b.label === label),
  );
  assertTruthy(
    found,
    `panelButtons() to carry a \`${action}\` control${
      label === undefined ? "" : ` labelled ${label}`
    } (specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PanelButton;
}

/** The panel's own control carrying that action, or a failure naming what was drawn. */
export async function pressControl(
  h: Harness,
  action: PressAction,
): Promise<PressButton> {
  const drawn = await h.debug.pressControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `pressControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PressButton;
}

/** The menu choice carrying that action, or a failure naming what was drawn. */
export async function menuControl(
  h: Harness,
  action: MenuAction,
): Promise<MenuButton> {
  const drawn = await h.debug.menuButtons();
  const found = drawn.find((b) => b.action === action);
  assertTruthy(
    found,
    `menuButtons() to carry a \`${action}\` choice ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as MenuButton;
}

/** The status-bar control carrying that action, or a failure naming what was drawn. */
export async function statusControl(
  h: Harness,
  action: StatusAction,
): Promise<StatusControl> {
  const drawn = await h.debug.statusControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `statusControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as StatusControl;
}

/**
 * The status bar's read carrying that name, or a failure naming what was drawn.
 *
 * `specs/hud.md` fixes the bar's reads and their left-to-right order and leaves
 * each one's rectangle to the build, so this is how a check finds a read without
 * knowing where it was drawn — and the rectangle it reports is where the read is,
 * so a pointer at its center is over it.
 */
export async function statusReadout(
  h: Harness,
  readout: ReadoutName,
): Promise<StatusReadout> {
  const drawn = await h.debug.statusReadouts();
  const found = drawn.find((r) => r.readout === readout);
  assertTruthy(
    found,
    `statusReadouts() to carry a \`${readout}\` read ` +
      `(specs/instrumentation.md); it carries ${describeReadouts(drawn)}`,
  );
  return found as StatusReadout;
}

/** Move the pointer to the center of the bar's read carrying that name. */
export async function hoverReadout(
  h: Harness,
  readout: ReadoutName,
): Promise<StatusReadout> {
  const read = await statusReadout(h, readout);
  const point = controlCenter(read);
  await h.debug.pointerMove(point.x, point.y);
  return read;
}

/**
 * Every ingredient cell the recipe book is drawing for one combination tower, in
 * the order `specs/combinations.md` lists that recipe's ingredients.
 *
 * The book's layout is the build's, so the build reports which cell it drew where
 * and in which of the three states `specs/hud.md` fixes. A check decides the state
 * from the report and reads pixels only inside the reported rectangle, for the
 * half of the requirement that is about the picture.
 */
export async function recipeCells(
  h: Harness,
  combo: ComboId,
): Promise<RecipeEntry[]> {
  const drawn = await h.debug.recipeEntries();
  const cells = drawn
    .filter((entry) => entry.combo === combo)
    .sort((a, b) => a.ingredient - b.ingredient);
  assertTruthy(
    cells.length > 0,
    `recipeEntries() to carry the ${combo}'s ingredient cells while the recipe ` +
      `book is open (specs/instrumentation.md); it carries ` +
      `${drawn.length === 0 ? "none" : `${drawn.length} cells, for ${[...new Set(drawn.map((e) => e.combo))].join(", ")}`}`,
  );
  return cells;
}

/**
 * One ingredient cell of one recipe, by the ingredient's index within it.
 *
 * The index is `specs/combinations.md`'s own order, counted from `0`, so a recipe
 * naming the same type twice is still two cells and a check can name either.
 */
export async function recipeCell(
  h: Harness,
  combo: ComboId,
  ingredient: number,
): Promise<RecipeEntry> {
  const cells = await recipeCells(h, combo);
  const found = cells.find((entry) => entry.ingredient === ingredient);
  assertTruthy(
    found,
    `recipeEntries() to carry the ${combo}'s ingredient ${ingredient} ` +
      `(specs/instrumentation.md); it carries ingredients ` +
      `${cells.map((entry) => entry.ingredient).join(", ")}`,
  );
  return found as RecipeEntry;
}

function describeControls(drawn: readonly { action: string }[]): string {
  return drawn.length === 0
    ? "none"
    : drawn.map((c) => `\`${c.action}\``).join(", ");
}

function describeReadouts(drawn: readonly { readout: string }[]): string {
  return drawn.length === 0
    ? "none"
    : drawn.map((r) => `\`${r.readout}\``).join(", ");
}

/** Find the inspector's control by action and press its center. */
export async function pressPanel(
  h: Harness,
  action: PanelAction,
  label?: string,
): Promise<void> {
  await clickControl(h, await panelControl(h, action, label));
}

/** Find the panel's own control by action and press its center. */
export async function pressPressControl(
  h: Harness,
  action: PressAction,
): Promise<void> {
  await clickControl(h, await pressControl(h, action));
}

/** Find the menu choice by action and press its center. */
export async function pressMenu(h: Harness, action: MenuAction): Promise<void> {
  await clickControl(h, await menuControl(h, action));
}

/** Find the status-bar control by action and press its center. */
export async function pressStatus(
  h: Harness,
  action: StatusAction,
): Promise<void> {
  await clickControl(h, await statusControl(h, action));
}

/**
 * Fire one action from the keyboard, through the surface's own input path.
 *
 * A press and a release of the key `specs/controls.md` binds the action to. Every
 * action but `modify` is read as a press edge, so this fires it exactly once; the
 * one-shot applies immediately, at the call, rather than being sampled on the
 * next frame.
 */
export async function pressAction(h: Harness, action: Action): Promise<void> {
  const key = keyFor(action);
  await h.debug.keyDown(key);
  await h.debug.keyUp(key);
}

/**
 * Run `body` with the `modify` action held, as a player holding Shift does.
 *
 * `modify` is read as a level rather than as an edge: what the game reads is
 * whether its key is down at the moment it reads it, so it modifies whatever act
 * it is held across. The release is in a `finally`, so a failing body cannot
 * leave the key down under the check that runs next.
 */
export async function withModify<T>(
  h: Harness,
  body: () => T | Promise<T>,
): Promise<T> {
  const key = keyFor("modify");
  await h.debug.keyDown(key);
  try {
    return await body();
  } finally {
    await h.debug.keyUp(key);
  }
}

/**
 * Show a menu screen and hand back the choices it presents, in order.
 *
 * `setScreen` moves to the screen exactly as reaching it in play does, and
 * `menuButtons` lays a frame out before it reads, so the choices come back
 * without the check advancing anything.
 */
export async function openMenu(
  h: Harness,
  screen: Screen,
): Promise<MenuButton[]> {
  await h.debug.setScreen(screen);
  return h.debug.menuButtons();
}

/* -------------------------------------------------------------------------- */
/* What a check reads off one drawn frame                                     */
/* -------------------------------------------------------------------------- */
//
// Everything below is a pure function over one frame's recorded operations or
// over a grid of sampled pixels, and every category that decides a point from
// what the build DREW reads it from here.
//
// WHY A FRAME'S TEXT IS NOT SIMPLY `callsTo(calls, "fillText")`. Two reasons, and
// a suite that ignored either would grade a build's layout choices rather than
// its reads.
//
//  1. A BUILD DRAWS UNDER ITS OWN TRANSFORM. `specs/overview.md` fixes the three
//     regions in the stage's logical units and says nothing about how a build
//     gets its pen there, so a bar drawn at a translated origin has to read the
//     same as one drawn in stage coordinates. Every anchor below is therefore
//     mapped through the transform in force at the call, and a check asks for the
//     text of a REGION rather than for the arguments of a call.
//  2. A BUILD IS FREE TO LETTER-SPACE. A label drawn one character at a time is
//     six `fillText` calls and the word `PAUSED` appears in none of them. So the
//     draws of a baseline are joined back into the line they read as: two single
//     characters close together are one word, and anything else is separated —
//     which is also what stops two neighbouring FIGURES from reading as one long
//     number.

/* -------------------------------------------------------------------------- */
/* Regions                                                                    */
/* -------------------------------------------------------------------------- */

/** A rectangle on the `1280 x 720` stage, as a half-open extent. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The status bar (`specs/overview.md`). */
export const BAR: Region = { x0: 0, y0: 0, x1: STAGE_W, y1: BAR_H };

/** The build panel (`specs/overview.md`). */
export const PANEL: Region = {
  x0: PANEL_X,
  y0: BAR_H,
  x1: PANEL_X + PANEL_W,
  y1: STAGE_H,
};

/** The yard (`specs/overview.md`). */
export const YARD: Region = {
  x0: BOARD_X,
  y0: BOARD_Y,
  x1: BOARD_X + BOARD_W,
  y1: BOARD_Y + BOARD_H,
};

/** A point falls inside a region. */
export function inRegion(region: Region, x: number, y: number): boolean {
  return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
}

/* -------------------------------------------------------------------------- */
/* The transform in force                                                     */
/* -------------------------------------------------------------------------- */

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function at(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** `count` numbers from `args`, starting at `from`, or `null`. */
function numbers(
  args: readonly unknown[],
  from: number,
  count: number,
): number[] | null {
  const taken: number[] = [];
  for (let i = from; i < from + count; i += 1) {
    const value = args[i];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    taken.push(value);
  }
  return taken;
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/** One `fillText` or `strokeText`, with its anchor mapped onto the stage. */
export interface TextDraw {
  text: string;
  x: number;
  y: number;
  /** Where it sat in the frame's operations, so two draws can be ordered. */
  index: number;
}

/** One operation of a frame, with the transform that was in force at it. */
interface Placed {
  call: { method: string; args: unknown[] };
  matrix: Matrix;
  index: number;
}

/**
 * Every call of a frame, each paired with the transform in force when it ran.
 *
 * The transform is tracked rather than assumed, because a build is free to draw
 * its yard, its bar, and its panel from any origin it likes and the
 * specification fixes only where the result lands.
 */
function placedCalls(calls: readonly DrawCall[]): Placed[] {
  const placed: Placed[] = [];
  const stack: Matrix[] = [];
  let m: Matrix = IDENTITY;
  calls.forEach((call, index) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    if (method === "save") {
      stack.push(m);
    } else if (method === "restore") {
      m = stack.pop() ?? IDENTITY;
    } else if (method === "translate") {
      const v = numbers(args, 0, 2);
      if (v) m = multiply(m, [1, 0, 0, 1, v[0]!, v[1]!]);
    } else if (method === "scale") {
      const v = numbers(args, 0, 2);
      if (v) m = multiply(m, [v[0]!, 0, 0, v[1]!, 0, 0]);
    } else if (method === "rotate") {
      const v = numbers(args, 0, 1);
      if (v) {
        const c = Math.cos(v[0]!);
        const s = Math.sin(v[0]!);
        m = multiply(m, [c, s, -s, c, 0, 0]);
      }
    } else if (method === "transform") {
      const v = numbers(args, 0, 6);
      if (v) m = multiply(m, v as Matrix);
    } else if (method === "setTransform") {
      const v = numbers(args, 0, 6);
      m = v ? (v as Matrix) : IDENTITY;
    } else if (method === "resetTransform") {
      m = IDENTITY;
    }
    placed.push({ call: { method, args }, matrix: m, index });
  });
  return placed;
}

/** Every text draw of a frame, each anchored where it actually landed. */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  for (const { call, matrix, index } of placedCalls(calls)) {
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const text = call.args[0];
    const v = numbers(call.args, 1, 2);
    if (typeof text !== "string" || !v) continue;
    const point = at(matrix, v[0]!, v[1]!);
    draws.push({ text, x: point.x, y: point.y, index });
  }
  return draws;
}

/** One `drawImage`, with the destination it blitted to mapped onto the stage. */
export interface ImageDraw {
  /** The destination rectangle's bounding box on the stage. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its center, which is where a rotated head lands whatever it was rotated by. */
  cx: number;
  cy: number;
  /** Where it sat in the frame's operations, so two draws can be ordered. */
  index: number;
}

/**
 * Every image a frame blitted, mapped onto the stage.
 *
 * A `drawImage` carries its destination in the last two or four of its
 * arguments; the three-argument form leaves the size to the image itself, which
 * the recorder cannot see, so that form reports a point rather than a rectangle.
 */
export function imageDraws(calls: readonly DrawCall[]): ImageDraw[] {
  const draws: ImageDraw[] = [];
  for (const { call, matrix, index } of placedCalls(calls)) {
    if (call.method !== "drawImage") continue;
    const args = call.args;
    const box =
      args.length >= 9
        ? numbers(args, 5, 4)
        : args.length >= 5
          ? numbers(args, 1, 4)
          : (() => {
              const point = numbers(args, 1, 2);
              return point === null ? null : [point[0]!, point[1]!, 0, 0];
            })();
    if (box === null) continue;
    const [dx, dy, dw, dh] = box as [number, number, number, number];
    const corners = [
      at(matrix, dx, dy),
      at(matrix, dx + dw, dy),
      at(matrix, dx, dy + dh),
      at(matrix, dx + dw, dy + dh),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const center = at(matrix, dx + dw / 2, dy + dh / 2);
    draws.push({
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      cx: center.x,
      cy: center.y,
      index,
    });
  }
  return draws;
}

/** How far apart two draws may sit and still read as one letter-spaced word. */
const LETTER_GAP = 24;

/** How far apart two baselines may sit and still read as one line. */
const LINE_GAP = 3;

/**
 * The lines a region's text reads as, top to bottom.
 *
 * Draws sharing a baseline are one line, ordered left to right, and two of them
 * are run together only when both are single characters set close enough to be
 * letter spacing. Everything else is separated by a space, so `473` beside `17`
 * never reads as `47317`.
 */
export function textLines(
  calls: readonly DrawCall[],
  region: Region,
): string[] {
  const draws = textDraws(calls)
    .filter((d) => inRegion(region, d.x, d.y))
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const lines: string[] = [];
  let baseline: number | null = null;
  let row: TextDraw[] = [];
  const close = (): void => {
    if (row.length === 0) return;
    const ordered = [...row].sort((a, b) => a.x - b.x);
    let line = "";
    let previous: TextDraw | null = null;
    for (const draw of ordered) {
      if (previous !== null) {
        const spaced =
          previous.text.length <= 1 &&
          draw.text.length <= 1 &&
          draw.x - previous.x < LETTER_GAP;
        if (!spaced) line += " ";
      }
      line += draw.text;
      previous = draw;
    }
    lines.push(line);
    row = [];
  };
  for (const draw of draws) {
    if (baseline === null || Math.abs(draw.y - baseline) > LINE_GAP) {
      close();
      baseline = draw.y;
    }
    row.push(draw);
  }
  close();
  return lines;
}

/** Every line of a region, joined, as one reading. */
export function textIn(calls: readonly DrawCall[], region: Region): string {
  return textLines(calls, region).join("\n");
}

/**
 * One reading of a piece of text: its letters and its digits, and nothing else.
 *
 * Case, spacing, and punctuation all come off, on both sides of a comparison,
 * because a build is free to letter-space a label, to wrap a long line, and to
 * set `Arc-Node` as `ARC NODE`. What the specification fixes is the words.
 */
function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** A region's text carries `needle`, read that way. */
export function drew(
  calls: readonly DrawCall[],
  region: Region,
  needle: string,
): boolean {
  return normalize(textLines(calls, region).join(" ")).includes(
    normalize(needle),
  );
}

/** `1,234` reads as one figure rather than as `1` beside `234`. */
function stripGrouping(line: string): string {
  let out = line;
  for (;;) {
    const next = out.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
    if (next === out) return out;
    out = next;
  }
}

/** Every number a region's text draws, in reading order. */
export function figures(calls: readonly DrawCall[], region: Region): number[] {
  const found: number[] = [];
  for (const line of textLines(calls, region)) {
    for (const match of stripGrouping(line).matchAll(/\d+(?:\.\d+)?/g)) {
      found.push(Number(match[0]));
    }
  }
  return found;
}

/**
 * The figure a region draws for `value`, or a failure naming what it drew.
 *
 * `tolerance` is the room a build has to round: `specs/pathing.md` reports a
 * route length in tiles as a real number, so a bar that draws `168` for `168.4`
 * has drawn the figure.
 */
export function drawnFigure(
  calls: readonly DrawCall[],
  region: Region,
  value: number,
  what: string,
  tolerance = 0.5,
): number {
  const drawn = figures(calls, region);
  const near = drawn
    .filter((f) => Math.abs(f - value) <= tolerance)
    .sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
  if (near.length === 0) {
    fail(
      `${what} drawn as ${value}${tolerance === 0 ? "" : ` (± ${tolerance})`}`,
      drawn,
    );
  }
  return near[0]!;
}

/* -------------------------------------------------------------------------- */
/* Pixels                                                                     */
/* -------------------------------------------------------------------------- */

/** A rectangle a reading reports, as `specs/instrumentation.md` gives it. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The distance two pixels are told apart by, of the 441 the cube spans. */
export const DISTINCT = 50;

/** A lattice of logical points inside a rectangle, `step` units apart. */
export function lattice(rect: Rect, step = 2): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let y = rect.y + step / 2; y < rect.y + rect.h; y += step) {
    for (let x = rect.x + step / 2; x < rect.x + rect.w; x += step) {
      points.push({ x, y });
    }
  }
  return points;
}

/** The straight-line distance between two colours, ignoring alpha. */
export function rgbDistance(a: Pixel, b: Pixel): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The furthest apart any one of two samplings of the same points reads. */
export function maxDistance(
  before: readonly Pixel[],
  after: readonly Pixel[],
): number {
  let worst = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    worst = Math.max(worst, rgbDistance(before[i]!, after[i]!));
  }
  return worst;
}

/** How many of two samplings of the same points read as told apart. */
export function changedPoints(
  before: readonly Pixel[],
  after: readonly Pixel[],
  threshold = DISTINCT,
): number {
  let changed = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    if (rgbDistance(before[i]!, after[i]!) > threshold) changed += 1;
  }
  return changed;
}

/** Draw one frame and sample it at every point given. */
export async function sample(
  h: Harness,
  points: readonly { x: number; y: number }[],
): Promise<Pixel[]> {
  await h.advance(1);
  return h.pixels(points);
}

// Gantry — the case's half of the validator harness, for the ENGINELESS build.
// CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own camera and projection, its own audio, its own
// asset loading and its own `window.__gantry` — and the only place all of that
// exists is a page that has loaded the bundle. So the project serves `dist/`,
// loads it in Chromium, and reaches the game the way anything reaches it: over
// the surface `specs/instrumentation.md` told the build to install.
//
// THE MACHINERY THAT DRIVES THE PAGE IS NOT GANTRY'S. Serving the build,
// connecting to the one browser, opening a page per harness, injecting the
// recorder and the audio probe, bracketing each driven frame around one step of
// the build's surface, and writing the evidence a review item declares — every
// engineless case needs exactly that, and it lives once, in
// `@test-cabinet/case-harness`, staged beside this file as `./case-harness/`.
// What is left here is what is genuinely Gantry's: the handle, the operations its
// specification requires, its snapshot and surface types, its stage and tick
// rate, its cue naming, and the compound sequences below.
//
// ONE API, THREE ENGINES. This file exports the same `Harness` interface as
// `validation/simple-3d/harness.ts` and `validation/structured-3d/harness.ts`,
// with every operation `async`, so a `<category>/<id>.test.ts` file is
// byte-identical in all three directories. The asynchrony is REAL here — each
// call crosses into Chromium — and vacuous there, which costs the engine
// harnesses nothing and buys one suite instead of three.
//
// FOUR THINGS THE CONTRACT LIFTS OUT OF `debug`. `specs/instrumentation.md` puts
// the clock, the projection and the raw input on the surface UNDER THIS ENGINE
// ONLY: nothing outside an engineless build owns its loop, its camera or its
// keyboard, so the surface has to. Under the two engines the engine owns all
// three and the surface carries no operation for any of them. So the harness
// lifts them out of `debug` and onto itself — `h.advance`, `h.project`,
// `h.keyDown`… — and a validator never learns that they were engine-only here.
//
// AND THIS FILE OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// one operation sets one field, and `specs/instrumentation.md` says so in as many
// words ("a caller that wants several things arranged makes several calls"). So
// opening a site, emptying the yard, standing a crane up, appending a tape and
// starting a run each live HERE, once, so five hundred suites say what their
// scenario is about in one line and say it the same way. A check that needs only
// part of a sequence calls the operations it needs.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import {
  createCaseHarness,
  type Harness as BaseHarness,
  type HarnessOptions,
} from "./case-harness/index";
import { fail } from "./assert";
import { STAGE_H, STAGE_W, TICK_HZ, UNBOUND_KEY } from "./constants";
import type {
  AxisName,
  CheckResult,
  GantryDebugApi,
  GantryDriver,
  GantrySnapshot,
  LoadClass,
  LoadPose,
  MaterialName,
  Projected,
  Screen,
  TapeAction,
  Vec3,
} from "./surface";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The page global an engineless build installs its surface on. */
export const HANDLE = "__gantry";

/** The version the surface reports (`GANTRY_DEBUG_VERSION`). */
export const GANTRY_DEBUG_VERSION = 1;

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, in the order that file introduces them — including the clock, the
 * projection and the five input operations, which exist only here.
 *
 * Written out in full rather than spread over the shared harness's
 * `BASE_REQUIRED_OPS`: this list is what a build is TOLD to install, and it is
 * the order a missing-operation fault names them back in. A build missing any one
 * of them cannot be driven at all, so every check that reaches for the surface
 * fails with that fault beside what the specification requires — which is the
 * verdict `specs/instrumentation.md` asks for, since the surface is a deliverable
 * rather than a convenience.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "snapshot",
  "check",
  "project",
  "reset",
  "setScreen",
  "setMenuIndex",
  "openSite",
  "setCleared",
  "setBest",
  "clearBest",
  "setCamera",
  "startRun",
  "abortRun",
  "clearStructure",
  "addMember",
  "removeMember",
  "setRing",
  "clearRing",
  "addCounterweight",
  "removeCounterweight",
  "setTool",
  "setPendingNode",
  "clearPendingNode",
  "clearProgram",
  "addMoveStep",
  "addCommand",
  "addActionStep",
  "removeStep",
  "clearLoads",
  "addLoad",
  "setLoadTarget",
  "clearObstacles",
  "addObstacle",
  "setAxis",
  "setAxisRate",
  "setBob",
  "setBobVelocity",
  "setLoadPose",
  "setLoadPhase",
  "setSpeedIndex",
  "pointerMove",
  "pointerDown",
  "pointerUp",
  "keyDown",
  "keyUp",
] as const;

/** The page global this project's own cue-naming probe installs itself on. */
const CUE_GLOBAL = "__gantryCues";

/** The page global this project's own paint gate installs itself on. */
const PAINT_GLOBAL = "__gantryPaint";

/** What `cues()` reports a sound whose produced file it could not name as. */
export const UNNAMED_CUE = "?";

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/** This module's own directory: the case's validator project. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The shared harness, with Gantry's snapshot, Gantry's surface and Gantry's
 * figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced still
 * is addressed by the running suite's path relative to the project root. Taken
 * from the package it would address every output one level too deep — and
 * silently, because a writer that raised on a failed write would be blaming the
 * build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<GantrySnapshot, GantryDebugApi>({
  slug: "gantry",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(ticks)`: a run of whole frames of the build's OWN fixed length.
  // `specs/instrumentation.md` fixes the length — "each covering `1 / TICK_HZ`
  // seconds of elapsed time" — so the caller passes a count and never a
  // duration. A `seconds-frames` binding here would hand the build a span it was
  // never asked to take.
  step: { kind: "count", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  // The run's own rate. Gantry's simulation is fixed at `TICK_HZ`, so `seconds`
  // and `ticks` below convert between run-clock seconds and the ticks a check
  // drives — the same arithmetic the run clock itself does (`tick / TICK_HZ`).
  tickHz: TICK_HZ,
  // A GENUINE browser gesture, so the build's audio can open: `specs/assets.md`
  // has sound wait for "the player's first interaction with the page", and a
  // build is free to open its audio context from a real DOM event alone, so a
  // gesture delivered through the surface's `keyDown` would leave a perfectly
  // good build silent. `KeyQ` is bound to no action, so arming changes nothing.
  arm: { kind: "key", code: UNBOUND_KEY },
  // Longer than the package's default. Gantry is a full-stack case: the build
  // decodes eight produced `.glb` models and twelve produced `.wav` files
  // (`specs/assets.md`) and a build is free to install its surface after that
  // work rather than before it. The wait is a poll that returns the instant the
  // global appears, so a conforming build pays none of this; what it bounds is
  // the cost of a build with no surface at all.
  // Gantry's engineless build fetches twenty produced files before it can
  // initialize, and one of them is a 9 MB music bed, so the wait is generous —
  // and it has to hold when four suites are loading their own page at once on a
  // host that is also running the build. A whole suite run measured this at
  // 20 s: not a hang, just a page waiting behind three others.
  surfaceTimeoutMs: 90_000,
  // `specs/ui.md` says of the title screen "The game opens on `title`", which is
  // a fact about what a FRESH game opens on rather than about what a `reset` puts
  // back — and every check runs after this harness's opening reset, so that half
  // of the requirement would be invisible without a reading taken first.
  readOpeningSnapshot: true,
  // Gantry draws through WebGL, so nothing here reads pixels off a 2D context;
  // what a still captures is the page's own composited frame.
  //
  // `paint-gate.js` takes the page off its own PAINT clock the moment the build's
  // surface answers, the way `setAutoStep(false)` takes it off the wall clock:
  // the frames `advance` is specified to run still paint, and the ones the
  // build's loop would have painted between two calls are held. A crossing into
  // a page that is painting freely costs about ten times one into a page that is
  // not, and this project drives enough of them for that to decide whether its
  // suites finish inside the platform's cap. The file's own header carries the
  // full reasoning, and `releasePaint` below is the way out for the one check
  // whose subject is the free-running loop itself.
  extraInitScripts: ["cues-init.js", "paint-gate.js"],
  projectRoot: PROJECT_ROOT,
});

export const { captureStill, fitViewport, failSurface, SURFACE_REQUIREMENT } =
  kit;

/** Seconds of run clock in `count` ticks, and the ticks covering a duration. */
export const { TICK_DT, TICK_MS, seconds, ticks, ticksFor } = kit;

export { TICK_HZ };

/**
 * Everything a check reads off one build.
 *
 * THE SAME INTERFACE THE TWO ENGINE PROJECTS EXPORT. Every member is `async`,
 * every member that reaches the game reaches it through the surface
 * `specs/instrumentation.md` fixes, and nothing here is spelled a way that only
 * makes sense in a browser — that is what lets one suite file grade three
 * runtimes.
 *
 * The three members below the fold are this engine's alone, and only the handful
 * of engine-specific suites `test-case.toml` points here touch them.
 */
export interface Harness {
  /** Release the page this harness held. */
  dispose(): Promise<void>;

  /** Every operation `specs/instrumentation.md` names, less the lifted ones. */
  readonly debug: GantryDriver;

  /** A fresh read of the game's own state. */
  snapshot(): Promise<GantrySnapshot>;
  /** The static check of `specs/structure.md`, computed on the spot. */
  check(): Promise<CheckResult>;

  /**
   * Run whole simulation ticks, and LEAVE THE WATCH SPEED ALONE.
   *
   * `specs/instrumentation.md`: "The watch speed scales what a frame covers
   * exactly as it scales a real frame, so a scenario counting ticks leaves the
   * speed where a run starts it." A run starts at speed index `0`
   * (`specs/state.md`), which is `RUN_SPEEDS[0]` (`1`), so one call here is one
   * tick of the pipeline `specs/program.md` fixes — and nothing in this harness
   * ever poses `setSpeedIndex`. A check that is ABOUT the watch speed poses it
   * itself and counts what it counts.
   */
  advance(ticks?: number): Promise<void>;

  /** Press a key down, as a player holding it does. */
  keyDown(code: string): Promise<void>;
  /** Release a key. */
  keyUp(code: string): Promise<void>;
  /** Down, one tick, up: the press a build reading actions per frame can see. */
  press(code: string): Promise<void>;
  /** Move the pointer to a logical stage position. */
  pointerMove(x: number, y: number): Promise<void>;
  /** A press at a logical stage position; it moves the pointer there first. */
  pointerDown(x: number, y: number): Promise<void>;
  /** A release at the position the pointer is at. */
  pointerUp(): Promise<void>;
  /** Down, a tick, up, a tick: the click a player's press makes. */
  click(x: number, y: number): Promise<void>;

  /** Where a world position is drawn, in logical stage units. */
  project(x: number, y: number, z: number): Promise<Projected>;

  /**
   * The cue names announced since the last read, in order, then cleared.
   *
   * A CUE A POSE RAISES SOUNDS ON THE FRAME THAT FOLLOWS IT, not at the call.
   * `specs/instrumentation.md` says a pose "establishes a precondition and never
   * an outcome; what happens next comes from advancing the real simulation", and
   * under an engine that holds the state by value a pose is pure and cannot
   * reach the audio bus at all — it queues the cue and the next update plays it.
   * So a check that reads a cue advances one frame first, which is correct on
   * every engine and is what keeps one validator file running in all three.
   */
  cues(): Promise<string[]>;
  /** The cue names of the sounds that are looping right now. */
  loopingCues(): Promise<string[]>;

  /** Keep the picture on screen as the review item's `id` output. */
  capture(id: string, name: string): Promise<void>;

  /**
   * Hand the page back its own paint loop, for the rest of this harness's life.
   *
   * ONLY FOR A CHECK WHOSE SUBJECT IS THAT LOOP. The harness holds the build's
   * free-running frames back (see `paint-gate.js`), which is invisible to every
   * check that drives the game with `advance` — the render each advanced frame is
   * specified to run still happens. It is NOT invisible to a check that lets
   * wall-clock time pass and asserts what did or did not move in it: a build that
   * keeps stepping through a `setAutoStep(false)` shows itself only to a page
   * that is still painting. Such a check calls this first, and pays the crossings
   * back at the free-running price.
   *
   * A no-op on the two engines, which have no page and no paint clock.
   */
  releasePaint(): Promise<void>;

  /**
   * Run one of the frames the page has asked for and is being held back from.
   *
   * FOR A CHECK THAT READS WHAT THE BUILD DRAWS AROUND THE CANVAS. `advance`
   * draws the canvas itself — the specification has every advanced frame followed
   * by a render, and that render happens inside the call — so a check reading the
   * picture needs nothing from this. A build is free to refresh what sits outside
   * the canvas on its own loop instead (this case's reference draws its
   * diagnostics overlay that way), and that loop is held; one pumped frame is
   * what a page painting freely would have given it.
   *
   * A no-op on the two engines, for the reason `releasePaint` gives.
   */
  paintFrame(): Promise<void>;

  /* ---- This engine's own, for the few suites that are about it ------------ */

  /** Why the build's surface cannot be driven, or `null` when it can. */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: readonly string[];
  /** What the build stood the game up in, before this harness reset it. */
  readonly openingSnapshot: GantrySnapshot | null;
  /** The page the build is running in, for a check that needs Playwright. */
  readonly page: Page;
  /** The ticks this harness has driven, 1-based. */
  tick(): number;
}

/**
 * The shared harness underneath each Gantry harness.
 *
 * Held here rather than exposed on {@link Harness}, because the two engine
 * projects have no such thing and a helper that reached for it would stop being
 * one file in three directories. What it buys the helpers below is the reading
 * that comes back FROM a drive — `step` and `until` answer the state the ticks
 * left, so `runTicks` and `runUntil` cost no extra crossing into the page.
 */
const bases = new WeakMap<
  Harness,
  BaseHarness<GantrySnapshot, GantryDebugApi>
>();

/** The shared harness under `h`, or a loud failure if it was not built here. */
function baseOf(h: Harness): BaseHarness<GantrySnapshot, GantryDebugApi> {
  const base = bases.get(h);
  if (base === undefined) {
    throw new Error(
      "gantry: this harness was not built by createHarness(), so the shared " +
        "driver underneath it is missing",
    );
  }
  return base;
}

/**
 * Open a page on the build, take the game off its own clock, and arm its audio.
 *
 * THE OPENING SEQUENCE, and why each part of it is here. The shared factory goes
 * to the served page, waits for `window.__gantry`, calls `setAutoStep(false)` and
 * then `reset()`, so from this point the game changes only when a check says so
 * and it stands where `specs/instrumentation.md` says a `reset` leaves it: the
 * title screen, site `0` open, nothing cleared, an idle run, `simTime` `0`.
 *
 * ARMING IS DONE HERE RATHER THAN LEFT TO A CHECK. A browser will not sound a
 * page that has had no user gesture, and `specs/assets.md` has the build wait for
 * one too. Every check that reads `cues()` would otherwise have to remember to
 * ask for the gesture, and the check that forgot would report silence from a
 * build that was sounding perfectly. The gesture is one press of `UNBOUND_KEY`,
 * which `specs/controls.md` binds to no action on any screen, so it changes
 * nothing a check could read.
 */
export async function createHarness(
  options?: HarnessOptions,
): Promise<Harness> {
  const base = await kit.createHarness(options);
  if (base.surfaceFault === null) await base.armAudio();

  const debug = base.debug as unknown as GantryDriver;

  const harness: Harness = {
    dispose: () => base.dispose(),
    debug,

    snapshot: () => base.snapshot(),
    check: () => base.debug.check(),

    advance: (count = 1) => base.advance(count),

    keyDown: (code) => base.debug.keyDown(code),
    keyUp: (code) => base.debug.keyUp(code),

    async press(code) {
      // Down, ONE tick, up. The tick between the two is what makes this a press
      // the build can actually see: it wrote its own keyboard layer, and the two
      // conformant ways to read a press — latching the edge as the event arrives,
      // or comparing held state at the top of each frame — agree only if the key
      // is genuinely held while a frame runs. `specs/instrumentation.md` says the
      // same thing from the other side: "a caller that needs the game to have
      // consumed one runs a frame after it."
      await base.debug.keyDown(code);
      await base.advance(1);
      await base.debug.keyUp(code);
    },

    pointerMove: (x, y) => base.debug.pointerMove(x, y),
    pointerDown: (x, y) => base.debug.pointerDown(x, y),
    pointerUp: () => base.debug.pointerUp(),

    async click(x, y) {
      // The same gesture a player makes, delivered through the same path:
      // `specs/instrumentation.md` says "a click is a `pointerDown` followed by a
      // `pointerUp`", and the pointer does not move between them, so the press
      // never reaches `CLICK_SLOP` and stays a click rather than an orbit drag
      // (`specs/controls.md`). A tick runs inside the press so a build that reads
      // the pointer once a frame sees it held, and a tick runs after the release
      // so a build that acts on the frame that reads the release has acted by the
      // time this returns.
      await base.debug.pointerDown(x, y);
      await base.advance(1);
      await base.debug.pointerUp();
      await base.advance(1);
    },

    project: (x, y, z) => base.debug.project(x, y, z),

    cues: () => readCues(base, "take"),
    loopingCues: () => readCues(base, "looping"),

    releasePaint: () => paint(base, "release"),
    paintFrame: () => paint(base, "pump"),

    async capture(id, name) {
      // One held frame first, so the picture composited into the still is the one
      // the build has just drawn. Everything the build draws on the canvas is
      // already there — `advance` renders — but a build is free to refresh what
      // sits AROUND the canvas on its own frame (this case's reference draws its
      // diagnostics overlay that way), and a still is the whole page.
      await paint(base, "pump");
      // The still is addressed by the review item's output id; the name is what
      // the reviewer is being shown, and it goes to the run log so a person
      // scanning the output can tell one still from another without opening it.
      await kit.captureStill(base, id);
      console.log(`gantry: captured ${id} — ${name}`);
    },

    surfaceFault: base.surfaceFault,
    pageErrors: base.pageErrors,
    openingSnapshot: base.openingSnapshot,
    page: base.page,
    tick: () => base.tick(),
  };

  bases.set(harness, base);
  return harness;
}

/**
 * Drive this project's paint gate.
 *
 * As with the cue probe, a page that does not carry it is a fault in this
 * project rather than in the build — the gate is injected before a line of the
 * build runs — so it says so rather than carrying on against a page whose frames
 * are not where this harness believes they are.
 */
async function paint(
  base: BaseHarness<GantrySnapshot, GantryDebugApi>,
  op: "pump" | "release",
): Promise<void> {
  const ran = await base.page.evaluate(
    ([global, name]) => {
      const gate = (
        window as unknown as Record<string, Record<string, () => void> | undefined>
      )[global];
      if (gate === undefined) return false;
      gate[name]!();
      return true;
    },
    [PAINT_GLOBAL, op] as const,
  );
  if (!ran) {
    throw new Error(
      `gantry: window.${PAINT_GLOBAL} is absent, so the harness's own paint ` +
        "gate did not run — validation/none/paint-gate.js is injected by " +
        "`extraInitScripts` and this is a fault in the validator project, not " +
        "in the build",
    );
  }
}

/**
 * Run one held frame on a page this project opened but does not hold a harness
 * for — a second page serving the build a swapped asset, say.
 *
 * The gate is installed on the CONTEXT, so every page in it carries one; what
 * such a page has no other route to is the harness method.
 */
export async function paintPage(page: Page): Promise<void> {
  await page.evaluate((global) => {
    const gate = (
      window as unknown as Record<string, { pump(): void } | undefined>
    )[global];
    if (gate !== undefined) gate.pump();
  }, PAINT_GLOBAL);
}

/**
 * Read this project's cue probe.
 *
 * The probe is the HARNESS's own instrumentation, injected before a line of the
 * build runs, so a page that does not carry it is a fault in this project rather
 * than in the build — and it throws rather than answering an empty list, because
 * an empty list is what "the build made no sound" looks like and the two must
 * never be confused.
 */
async function readCues(
  base: BaseHarness<GantrySnapshot, GantryDebugApi>,
  which: "take" | "looping",
): Promise<string[]> {
  const names = (await base.page.evaluate(
    ([global, op]) => {
      const probe = (
        window as unknown as Record<string, Record<string, () => string[]>>
      )[global];
      return probe === undefined ? null : probe[op]!();
    },
    [CUE_GLOBAL, which] as const,
  )) as string[] | null;
  if (names === null) {
    throw new Error(
      `gantry: window.${CUE_GLOBAL} is absent, so the harness's own cue probe ` +
        "did not run — validation/none/cues-init.js is injected by " +
        "`extraInitScripts` and this is a fault in the validator project, not " +
        "in the build",
    );
  }
  return names;
}

/* -------------------------------------------------------------------------- */
/* The reference cranes and tapes                                             */
/* -------------------------------------------------------------------------- */

/** A lattice node, as `designs.json` writes one. */
export type LatticeNode = readonly [number, number, number];

/** One member of a design: its two nodes and its material. */
export type DesignMember = readonly [LatticeNode, LatticeNode, MaterialName];

/** One tape step, in the shape `poseTape` appends and a snapshot reports. */
export type TapeStepSpec =
  | {
      readonly kind: "move";
      readonly commands: readonly {
        readonly axis: AxisName;
        readonly target: number;
        readonly rate: number;
      }[];
    }
  | { readonly kind: "action"; readonly action: TapeAction };

/**
 * One crane and the tape that runs it.
 *
 * `members` is ORDERED, and posing it in that order gives each member the id its
 * index here carries — which is what every force readout, every `broken` entry
 * and every `removeMember` in this suite is keyed by (`specs/instrumentation.md`:
 * "`addMember` gives the member the structure's `nextMemberId` and advances it by
 * one", and `clearStructure` returns that counter to `0`).
 */
export interface CraneDesign {
  /** The site this design was authored for, counted from 1 in the file. */
  readonly site: number;
  readonly name: string;
  readonly ring: LatticeNode | null;
  readonly counterweights: readonly LatticeNode[];
  readonly members: readonly DesignMember[];
  readonly tape: readonly TapeStepSpec[];
}

/**
 * The six reference cranes and tapes, one per site, in site order.
 *
 * A COPY beside this harness rather than an import across the tree: a validator
 * project reaches nothing outside itself, and the file it would have reached is
 * inside the reference build, which is not what a run produces. Read at module
 * load with `readFileSync` rather than imported as JSON, because the workspace's
 * `tsconfig.json` does not set `resolveJsonModule` and a validator project must
 * compile under the build's own compiler options.
 */
export const DESIGNS: readonly CraneDesign[] = (
  JSON.parse(readFileSync(join(PROJECT_ROOT, "designs.json"), "utf8")) as {
    sites: CraneDesign[];
  }
).sites;

/**
 * The smallest crane that stands: a ring on a short braced tower, one rail, and
 * the bracing that makes both rigid.
 *
 * WHAT A VALIDATOR USES WHEN ITS REQUIREMENT IS NOT ABOUT THE CRANE — the run
 * screen's readouts, the watch speed, a cue, an axis controller. Twenty-one
 * members instead of the sixty to a hundred and thirty a reference design
 * carries, so a scenario that just needs a crane to exist costs twenty-one
 * crossings rather than a hundred.
 *
 * WHY IT IS SHAPED THIS WAY, rule by rule from `specs/structure.md`:
 *
 *   - The tower is the cube between the four ground anchors every site carries
 *     and the ring's bottom flange at `y = 2`, braced with one diagonal on each
 *     of its four sides and one across its top. That is the classic sufficient
 *     bracing of a cube on a fixed base: without it the tower is a mechanism and
 *     the tower solve goes singular.
 *   - The ring sits at `(0, 2, 0)`, whose `y` is not `0` — "the ring sits on a
 *     tower, not on the ground".
 *   - The arm is the mast node `(0, 8, 0)`, tied to all four top-flange nodes so
 *     it is rigid, and the rail tip `(4, 4, 0)`, tied to two flange nodes, to the
 *     mast, and to the rail itself. The tie to the mast is the one member at the
 *     tip with a vertical component: without it every member there lies in the
 *     `y = 4` plane and the tip is free to fall, which is a singular arm solve.
 *   - The single rail runs from a top-flange node outward, horizontal, in the
 *     arm, and its two ends stand at different horizontal distances from the slew
 *     axis — the four track rules, satisfied by one member, with the near end as
 *     the track origin the trolley starts at.
 *
 * Every node lies inside every site's envelope and clear of every site's
 * obstacles, and the crane costs `981.43` against the smallest budget of `3000`,
 * so it poses on all six sites unrefused.
 */
export const MINIMAL_CRANE: CraneDesign = {
  site: 0,
  name: "Minimal",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    // The four legs, anchor to bottom flange.
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    // The bottom flange square, and one diagonal across it.
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 2], "strut"],
    // One diagonal on each of the tower's four sides.
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 0], [0, 2, 2], "strut"],
    [[2, 0, 0], [2, 2, 2], "strut"],
    [[0, 0, 2], [2, 2, 2], "strut"],
    // The mast, tied to all four top-flange nodes.
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[2, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[2, 4, 2], [0, 8, 0], "strut"],
    // The track, and the three ties that hold its far end up.
    [[0, 4, 0], [4, 4, 0], "rail"],
    [[0, 4, 2], [4, 4, 0], "strut"],
    [[2, 4, 2], [4, 4, 0], "strut"],
    [[0, 8, 0], [4, 4, 0], "strut"],
  ],
  tape: [],
};

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__gantry` and then lets the
// real simulation run. Nothing here fabricates an outcome: a pose "establishes a
// precondition and never an outcome; what happens next comes from advancing the
// real simulation" (`specs/instrumentation.md`).

/**
 * Open a site, leaving the build screen showing.
 *
 * `openSite` carries the effects `specs/state.md` states for opening a site — the
 * site's own loads and obstacles back in the yard, the undo history emptied, the
 * pending node and the shown check cleared, the camera back at its start pose,
 * the run back to its idle placeholder — and then shows `build`. It reaches any
 * site whether or not it has been unlocked, which is what lets a check about site
 * five's envelope run without playing four sites to reach it.
 */
export async function openSite(h: Harness, index: number): Promise<void> {
  await h.debug.openSite(index);
}

/**
 * The isolated world every validator starts from: no loads, no obstacles.
 *
 * The yard a site opens with is the site's authored set, and almost no check is
 * about that set: a check on a lift wants one load and a check on a strike wants
 * one obstacle. So the yard is emptied and exactly what the requirement concerns
 * is added back — never parked "somewhere harmless", because containment leans on
 * the rules that are under test.
 *
 * Loads and obstacles are the site's rather than the structure's, so this refuses
 * nothing and changes nothing that is built.
 */
export async function emptyYard(h: Harness): Promise<void> {
  await poseAll(h, await onEditScreenCalls(h, [["clearLoads"], ["clearObstacles"]]));
}

/**
 * The empty world: no loads, no obstacles, no structure, no tape.
 *
 * Three screens' worth of poses in one call — the site's and the structure's on
 * the build screen, the tape's on the program screen — so the screen is taken
 * where each applies and put back where the check was standing.
 */
export async function clearAll(h: Harness): Promise<void> {
  // The site's and the structure's poses apply on the build screen and the tape's
  // on the program screen, so the screen is taken where each applies and put back
  // where the check was standing — all of it in one crossing.
  const was = (await h.snapshot()).screen;
  const calls: PoseCall[] = [];
  if (was !== "build" && was !== "program") calls.push(["setScreen", "build"]);
  calls.push(["clearLoads"], ["clearObstacles"], ["clearStructure"]);
  calls.push(["setScreen", "program"], ["clearProgram"]);
  calls.push(["setScreen", was]);
  await poseAll(h, calls);
}

/**
 * Run a whole sequence of poses in ONE crossing into the page.
 *
 * WHY. Every call on the surface is a round trip, and a round trip against this
 * build costs about 30 ms — not the trip itself, but waiting on a renderer that
 * has just composited a 1280x720 WebGL frame under software GL. Posing a
 * reference crane member by member is 60 to 130 of them, so the pose costs
 * seconds before the check has driven a tick. The engineless suite has to fit
 * inside the platform's cap on a validator suite ON A TWO-CORE HOST, and a suite
 * the runner stops decides no point at all.
 *
 * WHAT IT DOES NOT CHANGE. The operations are the same operations, called in the
 * same order, on the same surface, so every rule `specs/structure.md` and
 * `specs/program.md` state runs exactly as it did — a refused edit is still
 * refused, silently, and the crane that stands at the end is still one a player
 * could have built. `specs/instrumentation.md` is explicit that a caller poses a
 * whole crane "as the sequence of edits that builds it"; this is that sequence,
 * delivered in one call rather than one call per edit. Nothing is batched INSIDE
 * the game: no tick is skipped and no pose is merged.
 *
 * Poses only. A reading has to come back across, and the verification each helper
 * does afterwards is what catches an edit the rules refused.
 */
type PoseCall = readonly [string, ...(string | number | boolean)[]];

/**
 * The same calls, bracketed onto a screen the SITE and STRUCTURE poses apply on.
 *
 * `onEditScreen` in call form: a pose that applies on `build` or `program` is left
 * where it stands, and anywhere else the screen is taken to `build` and put back.
 */
async function onEditScreenCalls(
  h: Harness,
  calls: readonly PoseCall[],
): Promise<PoseCall[]> {
  const was = (await h.snapshot()).screen;
  if (was === "build" || was === "program") return [...calls];
  return [["setScreen", "build"], ...calls, ["setScreen", was]];
}

async function poseAll(
  h: Harness,
  calls: readonly PoseCall[],
): Promise<void> {
  await h.page.evaluate(
    ({ handle, ops }) => {
      const surface = (window as unknown as Record<string, Record<string, unknown>>)[
        handle
      ];
      for (const [name, ...args] of ops) {
        (surface[name] as (...a: unknown[]) => unknown)(...args);
      }
    },
    { handle: HANDLE, ops: calls as (string | number | boolean)[][] },
  );
}

/**
 * Pose a whole crane as the ordered sequence of edits that BUILDS it — the ring,
 * then each member in order, then the counterweights — so it passes exactly the
 * rules a player builds under.
 *
 * THE ORDER IS THE POINT. `specs/instrumentation.md`: "A caller that wants a whole
 * crane poses it as the sequence of edits that builds it, which is what puts it
 * under the same rules a player builds under." Every refusal in
 * `specs/structure.md` therefore applies unchanged, and the crane that stands at
 * the end is one a player could have built.
 *
 * THE STRUCTURE IS EMPTIED FIRST, so the first member placed takes id `0` and the
 * ids run upward in the order the design lists them — which is what every force
 * readout, `broken` entry and `removeMember` in this suite is keyed by.
 * `clearStructure` is refused by nothing.
 *
 * THE RING GOES FIRST because it can: with nothing built, the only ring refusals
 * left are the envelope and the budget, and placing it first means no later member
 * can be refused for joining the arm to the tower outside it.
 *
 * AND IT THROWS IF ANY EDIT WAS REFUSED. A refusal is silent by design — "no
 * member appears, no cost is spent" — so a scenario whose crane quietly lost a
 * member would grade a different crane from the one it described. One snapshot at
 * the end says whether every edit landed, and names the first that did not.
 */
export async function poseCrane(
  h: Harness,
  design: CraneDesign,
): Promise<void> {
  const was = (await h.snapshot()).screen;
  const calls: PoseCall[] = [];
  if (was !== "build") calls.push(["setScreen", "build"]);
  calls.push(["clearStructure"]);
  if (design.ring !== null) {
    calls.push(["setRing", design.ring[0], design.ring[1], design.ring[2]]);
  }
  for (const [a, b, material] of design.members) {
    calls.push(["addMember", a[0], a[1], a[2], b[0], b[1], b[2], material]);
  }
  for (const node of design.counterweights) {
    calls.push(["addCounterweight", node[0], node[1], node[2]]);
  }
  if (was !== "build") calls.push(["setScreen", was]);
  await poseAll(h, calls);

  const { structure } = await h.snapshot();
  const placed = new Set(structure.members.map((m) => edgeKey(m.a, m.b)));
  const missing = design.members.findIndex(
    ([a, b]) => !placed.has(edgeKey(nodeOf(a), nodeOf(b))),
  );
  if (missing >= 0) {
    const [a, b, material] = design.members[missing] as DesignMember;
    fail(
      `every edit of the ${design.name} crane to be accepted ` +
        `(specs/structure.md), so member ${missing} — a ${material} from ` +
        `(${a.join(", ")}) to (${b.join(", ")}) — stands`,
      `refused: the structure carries ${structure.members.length} of ` +
        `${design.members.length} members`,
    );
  }
  if (design.ring !== null && structure.ring === null) {
    fail(
      `the ${design.name} crane's slew ring at (${design.ring.join(", ")}) to ` +
        "be accepted (specs/structure.md)",
      "refused: the structure carries no ring",
    );
  }
  if (structure.counterweights.length !== design.counterweights.length) {
    fail(
      `the ${design.name} crane's ${design.counterweights.length} ` +
        "counterweights to be accepted (specs/structure.md)",
      `${structure.counterweights.length} stand`,
    );
  }
}

/** The smallest crane that stands, posed on the open site. */
export async function standMinimalCrane(h: Harness): Promise<void> {
  await poseCrane(h, MINIMAL_CRANE);
}

/**
 * Append a tape, step by step, through the tape operations.
 *
 * A move step is `addMoveStep` for its first command and one `addCommand` per
 * command after it, because `specs/instrumentation.md` gives no operation that
 * appends a whole step: "Appends a move step carrying one command", then "Adds a
 * command to the move step at `index`". The index is the step's own position in
 * the tape, so this counts from whatever the tape already holds — it APPENDS
 * rather than replaces, and a check that wants an empty tape first calls
 * `debug.clearProgram` or {@link clearAll}.
 *
 * Tape edits apply on the program screen alone, so the screen is taken there and
 * put back: what a check reads afterwards is the tape it asked for and the screen
 * it was on.
 *
 * It throws if the tape did not take the steps it was given: the editor's
 * refusals are silent (`specs/program.md` accepts a rate greater than `0` and at
 * most the axis's max, one command per axis per step, and nothing else), so a
 * scenario running a tape it did not get would grade the wrong run.
 */
export async function poseTape(
  h: Harness,
  steps: readonly TapeStepSpec[],
): Promise<void> {
  const before = (await h.snapshot()).program.length;
  await onScreen(h, "program", async () => {
    for (const [offset, step] of steps.entries()) {
      const at = before + offset;
      if (step.kind === "action") {
        await h.debug.addActionStep(step.action);
        continue;
      }
      const [first, ...rest] = step.commands;
      if (first === undefined) {
        fail(
          "every move step to carry at least one command (specs/program.md)",
          `step ${at} carries none`,
        );
      }
      await h.debug.addMoveStep(first.axis, first.target, first.rate);
      for (const command of rest) {
        await h.debug.addCommand(
          at,
          command.axis,
          command.target,
          command.rate,
        );
      }
    }
  });

  const program = (await h.snapshot()).program;
  if (program.length !== before + steps.length) {
    fail(
      `the tape to take all ${steps.length} steps (specs/program.md)`,
      `it holds ${program.length - before} of them`,
    );
  }
  for (const [offset, step] of steps.entries()) {
    const got = program[before + offset];
    if (got === undefined || got.kind !== step.kind) {
      fail(
        `step ${offset} of the posed tape to be a ${step.kind} step`,
        got === undefined ? "nothing" : `a ${got.kind} step`,
      );
    }
    if (step.kind === "move" && got.kind === "move") {
      if (got.commands.length !== step.commands.length) {
        fail(
          `step ${offset} to carry all ${step.commands.length} commands ` +
            "(specs/program.md)",
          `it carries ${got.commands.length}`,
        );
      }
    }
  }
}

/**
 * Start a run, and fail the check if it was refused.
 *
 * `startRun` poses the `run` action: the same refusals, the same `run-start` cue,
 * the same move to the run screen (`specs/program.md`). A refused start leaves
 * the state exactly as it was and is silent, so this reads the phase back — a
 * scenario that thought it was running and was not would read an idle
 * placeholder's zeros as a simulation result.
 *
 * The snapshot it answers with is the run at tick `0`: "nothing has ticked at the
 * call, so `run.tick` reads `0` immediately after it, and the axes, the pivot,
 * and the bob stand at the run-start values" `specs/state.md` gives.
 */
export async function startRun(h: Harness): Promise<GantrySnapshot> {
  await h.debug.startRun();
  const snapshot = await h.snapshot();
  if (snapshot.run.phase !== "running") {
    const { issues } = await h.check();
    fail(
      "the run to start, so the structure has no readiness issue and the tape " +
        "is not empty (specs/program.md)",
      `refused: run.phase is "${snapshot.run.phase}" and check() reports ` +
        `[${issues.join(", ")}]`,
    );
  }
  return snapshot;
}

/** Run `count` ticks, and answer the state they left. */
export async function runTicks(
  h: Harness,
  count: number,
): Promise<GantrySnapshot> {
  return baseOf(h).step(count);
}

/**
 * Run a tick at a time until `predicate` holds, and FAIL the check on the cap.
 *
 * The cap is not a quiet ceiling: a scenario that waited for a load to attach and
 * never saw it attach has learned something about the build, and reporting that
 * as "the predicate did not hold, carry on" would let the check fall through to
 * an assertion about a state it never reached. So the cap fails the item, naming
 * how long it waited.
 *
 * The predicate is sampled BEFORE anything is driven, so a condition that already
 * holds answers at zero ticks. Capture whatever the scenario needs to be true
 * beforehand rather than reading it out of the sweep.
 */
export async function runUntil(
  h: Harness,
  predicate: (snapshot: GantrySnapshot) => boolean,
  maxTicks: number,
  what = "the condition",
): Promise<GantrySnapshot> {
  const swept = await baseOf(h).until(predicate, { maxTicks, poll: 1 });
  if (!swept.hit) {
    fail(
      `${what} within ${maxTicks} ticks (${(maxTicks / TICK_HZ).toFixed(2)}s ` +
        "of run clock)",
      `it never held: after ${swept.ticks} ticks the run is ` +
        `"${swept.snapshot.run.phase}"` +
        (swept.snapshot.run.cause === null
          ? ""
          : ` (${swept.snapshot.run.cause})`),
    );
  }
  return swept.snapshot;
}

/**
 * The yard holding exactly one load: cleared, then one added and given its pad.
 *
 * `addLoad` starts a load "at rest with its lift point at `(x, y, z)`" and gives
 * it a target pose equal to its starting pose, so the pad is a second call —
 * which is also what lets a check pose a load that is ALREADY where it is wanted.
 */
export async function addOneLoad(
  h: Harness,
  cls: LoadClass,
  mass: number,
  from: LoadPose,
  to: LoadPose,
): Promise<void> {
  await poseAll(
    h,
    await onEditScreenCalls(h, [
      ["clearLoads"],
      ["addLoad", cls, mass, from.x, from.y, from.z, from.yaw],
      ["setLoadTarget", 0, to.x, to.y, to.z, to.yaw],
    ]),
  );
}

/** The yard holding exactly one obstacle: the box with that corner and size. */
export async function addOneObstacle(
  h: Harness,
  min: Vec3,
  size: Vec3,
): Promise<void> {
  await poseAll(
    h,
    await onEditScreenCalls(h, [
      ["clearObstacles"],
      ["addObstacle", min.x, min.y, min.z, size.x, size.y, size.z],
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/* Small shared readings                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Run `body` on `screen`, and put the screen back where it was.
 *
 * `specs/instrumentation.md`: "Each pose applies on the screens its section names
 * and does nothing on any other, exactly as the control it stands for does." The
 * structure poses are the build screen's and the tape poses are the program
 * screen's, so a helper that edits either has to be standing on the right one —
 * and has to leave the check where it found it, because the screen is a thing
 * checks read. `setScreen` "shows a named screen and sets nothing else", so
 * nothing else moves either way.
 */
async function onScreen<T>(
  h: Harness,
  screen: Screen,
  body: () => Promise<T>,
): Promise<T> {
  const was = (await h.snapshot()).screen;
  if (was === screen) return body();
  await h.debug.setScreen(screen);
  try {
    return await body();
  } finally {
    await h.debug.setScreen(was);
  }
}

/**
 * Run `body` on a screen the SITE poses apply on, and put the screen back.
 *
 * `specs/instrumentation.md`: "The site poses apply on the build and program
 * screens, with no run in progress." Either of the two will do, so a check
 * already standing on the program screen is left there and only one that is
 * somewhere else is moved — to `build`, which is where a site opening leaves a
 * check anyway.
 *
 * THE SECOND HALF OF THAT PRECONDITION IS THE CALLER'S. A run in progress refuses
 * every site pose whatever screen is showing, and nothing here aborts a run to get
 * around it: a helper that ended a check's run to empty its yard would be posing
 * an outcome. A check that wants a different yard poses it before it starts the
 * run, which is also the only order in which it means anything — "the loads a run
 * carries are the ones standing when it starts".
 */
async function onEditScreen<T>(h: Harness, body: () => Promise<T>): Promise<T> {
  const was = (await h.snapshot()).screen;
  if (was === "build" || was === "program") return body();
  await h.debug.setScreen("build");
  try {
    return await body();
  } finally {
    await h.debug.setScreen(was);
  }
}

/** A design's lattice triple as the vector the snapshot reports. */
function nodeOf(node: LatticeNode): Vec3 {
  return { x: node[0], y: node[1], z: node[2] };
}

/** A member's two nodes, in an order that is the same either way round. */
function edgeKey(a: Vec3, b: Vec3): string {
  const one = `${a.x},${a.y},${a.z}`;
  const two = `${b.x},${b.y},${b.z}`;
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

/** The straight-line distance between two world positions. */
export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Where a lattice node is drawn, as a point a click can pick it by.
 *
 * `specs/controls.md` fixes how a click PICKS rather than how the yard is drawn,
 * so a check that wants to click a node asks the build where it drew it — "a
 * press and release at a visible node's projected point picks that node".
 */
export async function nodePoint(h: Harness, node: Vec3): Promise<Projected> {
  return h.project(node.x, node.y, node.z);
}

/* -------------------------------------------------------------------------- */
/* What a suite reads from here                                               */
/* -------------------------------------------------------------------------- */

export type {
  AxisName,
  AxisView,
  CheckResult,
  FailCause,
  GantryDebugApi,
  GantryDriver,
  GantrySnapshot,
  LoadClass,
  LoadPhase,
  LoadPose,
  MaterialName,
  MemberForce,
  MemberView,
  Obstacle,
  PickView,
  PointerView,
  Projected,
  ReadinessIssue,
  RunLoadView,
  RunPhase,
  RunView,
  Screen,
  SiteLoad,
  SiteView,
  StartIssue,
  StepView,
  StructureView,
  TapeAction,
  Tool,
  Vec3,
} from "./surface";

export type { HarnessOptions } from "./case-harness/index";

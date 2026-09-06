// Volute — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own audio, its own loading of the produced files,
// and its own `window.__volute` — and the only place all of that exists is a page
// that has loaded the bundle. So the project serves `dist/`, loads it in
// Chromium, and reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// THE MACHINERY THAT DOES THAT IS NOT VOLUTE'S. Serving the build, connecting to
// the one browser, opening a page per harness, injecting the draw-command
// recorder and the audio probe, bracketing each driven tick around one
// `step(1)` of the build's surface, reading pixels and draw calls back out, and
// writing the evidence a review point declares — every engineless case needs
// exactly that, and it lives once, in `@clockwyrks/case-harness`, staged beside
// this file as `./case-harness/`. What is left here is what is genuinely
// Volute's: the shape of its snapshot, the operations `specs/instrumentation.md`
// requires, the channel's own geometry, and the hall a scenario poses.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Volute's names and Volute's types on it — so the suites next door go on
// importing `createHarness`, `captureReplay`, `poseHall` and the tick arithmetic
// from `../harness` exactly as they did, and none of them can tell the difference.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/channel/feed-advance.test.ts` is the same path whichever runtime
// the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__volute`'s
// `snapshot`), the ticks the harness itself drove, the operations the build
// issued against its 2D context, the pixels those operations left on the canvas,
// and the sounds the build emitted. Nothing here fabricates an outcome: the
// scenario helpers below only ARRANGE the hall through the surface, and the real
// tick the build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `step(ticks)` runs whole simulation ticks.
// Every harness opens by taking the game off the clock, so a check asks for a
// number of ticks and gets exactly that number — no polling, no waiting, and no
// measurement of the machine it ran on. The one check that is ABOUT the loop
// running itself (`channel/self-advancing`) hands it back with {@link Harness.runFor}.
//
// A TICK IS THE UNIT. `specs/instrumentation.md` fixes the simulation at 60 ticks
// a second, each worth exactly 1/60 s, so a count of stepped ticks converts to
// simulated seconds with no rounding and no ambiguity about what a step means.
// Every duration in this project is written as a tick count for that reason.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setPressure(50)` rather than
// `h.debug.setPressure(50)`. The scenarios, the tolerances, and the assertions
// are the same ones, because they are the case's rather than the runtime's.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCaseHarness,
  type Harness as BaseHarness,
  type PixelRect,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { assertTruthy } from "./assert";
import {
  BINDINGS,
  CELLS,
  CHANNEL,
  CHANNEL_ARC,
  FIELD_H,
  FIELD_W,
  HANDLE,
  INJECTOR,
  OPENING_AIM,
  PATH_LENGTH,
  REQUIRED_OPS,
  SPACING,
  TICK_HZ,
  UNBOUND_KEY,
  levelSpec,
  type ChargeId,
  type MachineryKind,
  type Point,
  type ScreenName,
  type TimedMachineryKind,
} from "./constants";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** One core of the train, as `snapshot()` reports it. */
export interface TrainCore {
  /** The arc position, from the inlet along the channel polyline. */
  s: number;
  /** The field point that arc position gives. */
  x: number;
  y: number;
  charge: ChargeId;
  mark: MachineryKind | null;
  /** `0` is the lead segment, rising toward the tail. */
  segment: number;
}

/** One segment, as `snapshot()` reports it. */
export interface SegmentView {
  count: number;
  /** The recoil hold's seconds left. */
  hold: number;
}

/** One projectile, as `snapshot()` reports it. */
export interface ProjectileView {
  x: number;
  y: number;
  /** The heading it was fired along, in degrees. */
  angle: number;
  charge: ChargeId;
}

/** The injector, as `snapshot()` reports it. */
export interface InjectorView {
  aim: number;
  cooldown: number;
  loaded: ChargeId | null;
  queued: ChargeId | null;
}

/** The timed machinery in force, as `snapshot()` reports it. */
export interface MachineryView {
  kind: MachineryKind;
  remaining: number;
}

/**
 * The state a snapshot reports, as `specs/instrumentation.md` documents it under
 * "Snapshot shape".
 *
 * "The shape is fixed, and every field is present whatever the screen."
 */
export interface VoluteSnapshot {
  version: number;
  screen: ScreenName;
  score: number;
  level: number;
  cells: number;
  /** The cores the inlet has left to emit this level. */
  quotaRemaining: number;
  /** The level's quota less `quotaRemaining`. */
  emitted: number;
  pressure: number;
  /** The effective feed speed, in units/s. */
  feedSpeed: number;
  chainStep: number;
  /** Seconds left before the step returns to 1. */
  chainTimer: number;
  /** Seconds left of the interlude, else 0. */
  interlude: number;
  danger: boolean;
  /** Every core on the channel, head first. */
  train: TrainCore[];
  /** The segments, head first, entry 0 the lead segment. */
  segments: SegmentView[];
  injector: InjectorView;
  /** Every projectile, oldest first. */
  projectiles: ProjectileView[];
  machinery: MachineryView | null;
  /** Whether the inlet emits. */
  emission: boolean;
  /** Whether the train advances. */
  feed: boolean;
  /** Whether the frame loop advances the simulation. */
  autoStep: boolean;
  muted: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
  /** The charge posed for the next emission, `null` while none stands. */
  nextEmitted: ChargeId | null;
}

/**
 * One core as `poseTrain` takes it: `[s, charge, mark]`.
 *
 * "`s` is an arc position, clamped to at most `5000`; `charge` is one of the five
 * charge ids; and `mark` is one of the four machinery kinds or `null` for an
 * unmarked core."
 */
export type PosedCore = [
  s: number,
  charge: ChargeId,
  mark: MachineryKind | null,
];

/** The operations a check poses the hall through. Every one crosses into the page. */
export interface VoluteDebugApi {
  /** Take the game off real time, and give it back. */
  setAutoStep(enabled: boolean): Promise<void>;
  /**
   * Run whole simulation ticks, each the full tick followed by a render.
   *
   * Prefer {@link Harness.step}, which brackets each tick for the recorder and
   * the audio probe. This is here for the check that reflects the surface.
   */
  step(ticks?: number): Promise<void>;
  /** Restore every declared field to its title value. */
  reset(): Promise<void>;
  /** A pure read of the running game. */
  snapshot(): Promise<VoluteSnapshot>;
  /** Set the screen, and change nothing else. */
  setScreen(name: ScreenName): Promise<void>;
  /** Set the level in play, and change nothing else. */
  setLevel(level: number): Promise<void>;
  /** Set the run's score, clamped to at least 0. */
  setScore(n: number): Promise<void>;
  /** Set the cells remaining, clamped to 0 through CELLS. It ends no run. */
  setCells(n: number): Promise<void>;
  /** Set the chain step, and restart the window that returns it to 1. */
  setChainStep(k: number): Promise<void>;
  /** Open `level`, exactly as the interlude before it opens it. */
  startLevel(level: number): Promise<void>;
  /** Replace every core on the channel with the cores given. */
  poseTrain(cores: readonly PosedCore[]): Promise<void>;
  /** Remove every core from the channel and every projectile. */
  clearTrain(): Promise<void>;
  /** Set the charge the injector holds loaded, and nothing else. */
  setLoaded(charge: ChargeId): Promise<void>;
  /** Set the charge the injector holds queued, and nothing else. */
  setQueued(charge: ChargeId): Promise<void>;
  /** Pose the charge of the next core the inlet emits, or clear it with `null`. */
  setNextEmitted(charge: ChargeId | null): Promise<void>;
  /** Set the aim, normalized into [0, 360). Releases nothing. */
  setAim(angleDegrees: number): Promise<void>;
  /** Release the loaded core along the current aim. Always launches. */
  fire(): Promise<void>;
  /** Set the pressure, clamped to 0 through 100. */
  setPressure(value: number): Promise<void>;
  /** Set the cores the inlet has left to emit this level. */
  setQuotaRemaining(n: number): Promise<void>;
  /** Hold the inlet, or let it go again. Independent of the quota. */
  setEmission(enabled: boolean): Promise<void>;
  /** Hold the train where it stands, or let it advance again. */
  setFeed(enabled: boolean): Promise<void>;
  /** Grant one of the three timed kinds, as extracting its mark grants it. */
  grantMachinery(kind: TimedMachineryKind): Promise<void>;
  /** Pose the pause control: the screen becomes `paused`. */
  pause(): Promise<void>;
  /** Pose it again: the screen returns to `playing`. */
  resume(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shared harness, with Volute's snapshot, Volute's surface and Volute's
 * figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<VoluteSnapshot, VoluteDebugApi>({
  slug: "volute",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `step(ticks)`: a number of whole simulation ticks of the build's OWN fixed
  // length. The operation is named `step` here and `advance` in the three cases
  // that fix the length of a frame from outside — which is why the package's
  // shared list of required operations stops short of naming the step at all,
  // and why this case's own `REQUIRED_OPS` in `constants.ts` is what a surface
  // fault reports against.
  step: { kind: "count", op: "step" },
  stage: { width: FIELD_W, height: FIELD_H },
  tickHz: TICK_HZ,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a key delivered any other way would leave a perfectly good build silent.
  // `UNBOUND_KEY` is bound to nothing (specs/controls.md), so arming changes no
  // game state.
  arm: { kind: "key", code: UNBOUND_KEY },
  // The context reports a touchscreen, because `specs/controls.md` has "a mouse,
  // a pen, and a touch contact all reach the game as one pointer" and
  // `screens/start-touch` drives a real contact. With this set a contact arrives
  // as `pointerType: "touch"` and `navigator.maxTouchPoints` is non-zero, which
  // is the device a build that answers a finger has to believe it is on; without
  // it a touch gesture is refused outright rather than quietly arriving as a
  // mouse.
  hasTouch: true,
  // Read the screen the build stood the game up on, BEFORE the opening reset.
  // `specs/ui.md` says of the title screen "The game opens here", which is a fact
  // about what a fresh game OPENS on and not about what a `reset` puts it back
  // to — and every check runs after the reset, so that half of the requirement
  // would be invisible without a reading taken first (`screens/title`).
  readOpeningSnapshot: true,
  // FIFTEEN SECONDS RATHER THAN THE FIVE A SHORTER CASE ALLOWS, because the
  // ceiling is not really on the build: it is on the host. This project holds
  // four pages of one browser open at once, the machine that runs it is running a
  // model's build under it, and a full-stack build loads the produced art and
  // audio it committed before it is ready. Fifteen costs a healthy build nothing,
  // because the poll returns the instant the global appears.
  surfaceTimeoutMs: 15_000,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
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
} = kit;

/**
 * An arc gain measured over `ticks` ticks, as a speed in units/s.
 *
 * THE SIGNED READING, and that is the whole point of the name it is bound to. The
 * package ships two: `speedOverTicks`, which takes the magnitude, and
 * `gainOverTicks`, which keeps the sign. Every speed this case measures is a
 * train's progress ALONG the channel, and a check that the feed advances must
 * fail a build whose train ran backwards — so the magnitude, which would pass it,
 * is the wrong one, and the signed rate is bound here under the name the suites
 * already say.
 */
export const speedOverTicks = kit.gainOverTicks;

/**
 * Everything a check reads off one page running this build.
 *
 * A bound alias of the shared harness's interface, so every
 * `import { type Harness } from "../harness"` next door goes on naming a harness
 * whose `snapshot()` is a {@link VoluteSnapshot} and whose `debug` is a
 * {@link VoluteDebugApi}.
 */
export type Harness = BaseHarness<VoluteSnapshot, VoluteDebugApi>;

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<VoluteSnapshot>;

export type {
  Clock,
  DrawCall,
  HarnessOptions,
  ImageDraw,
  ImageRef,
  Pixel,
  PixelRect,
  RecordedFrame,
  RecordedOp,
  RecordedPathSegment,
  RecordedResource,
  RecordedState,
  Recording,
  TextDraw,
  TimedCue,
  UntilOptions,
  Viewport,
} from "./case-harness/index";

export {
  callsTo,
  closeWorkerBrowser,
  differingPoints,
  distance,
  drawnPoints,
  drawnText,
  drawOps,
  drewText,
  imageDraws,
  imageRef,
  pixelsDiffering,
  pointsNear,
  retable,
  setsOf,
  stepUntilBed,
  stepUntilSound,
  textDraws,
  thinReplay,
  touchPress,
  touchRelease,
  touchTap,
  DRAW_METHODS,
  DEFAULT_REPLAY_BACKGROUND as REPLAY_BACKGROUND,
} from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The train is reported head first, so `train[0]` is the head and the last entry
// is the tail. These name that rather than leaving every suite to remember it,
// and each of them FAILS the point when the reading is not there — a build whose
// snapshot reports no train at all is a build whose surface cannot be driven, and
// `writing-debug-apis-and-validators` puts that on the point rather than leaving
// it undecided.

/** The head: the core with the greatest arc position. */
export function head(snapshot: VoluteSnapshot): TrainCore {
  const core = snapshot.train?.[0];
  assertTruthy(
    core,
    "a core on the channel, reported head first as snapshot().train " +
      "(specs/instrumentation.md)",
  );
  return core as TrainCore;
}

/** The tail: the core with the least arc position. */
export function tail(snapshot: VoluteSnapshot): TrainCore {
  const train = snapshot.train ?? [];
  const core = train[train.length - 1];
  assertTruthy(
    core,
    "a core on the channel, reported head first as snapshot().train " +
      "(specs/instrumentation.md)",
  );
  return core as TrainCore;
}

/** How many cores stand on the channel. */
export function coreCount(snapshot: VoluteSnapshot): number {
  return snapshot.train?.length ?? 0;
}

/** Every core's arc position, head first. */
export function arcPositions(snapshot: VoluteSnapshot): number[] {
  return (snapshot.train ?? []).map((core) => core.s);
}

/** Every core's charge, head first. */
export function charges(snapshot: VoluteSnapshot): ChargeId[] {
  return (snapshot.train ?? []).map((core) => core.charge);
}

/** Every core carrying a mark, head first. */
export function markedCores(snapshot: VoluteSnapshot): TrainCore[] {
  return (snapshot.train ?? []).filter((core) => core.mark !== null);
}

/**
 * The core nearest arc position `s`, or `undefined` on an empty channel.
 *
 * What a check that posed a core and then let the hall run reads it back with:
 * the core moved, so its index may have moved too, and its arc position is the
 * thing that identifies it.
 */
export function coreNear(
  snapshot: VoluteSnapshot,
  s: number,
): TrainCore | undefined {
  let best: TrainCore | undefined;
  let bestGap = Infinity;
  for (const core of snapshot.train ?? []) {
    const gap = Math.abs(core.s - s);
    if (gap < bestGap) {
      bestGap = gap;
      best = core;
    }
  }
  return best;
}

/** The core carrying `charge`, or `undefined` — the train holds at most one. */
export function coreWithCharge(
  snapshot: VoluteSnapshot,
  charge: ChargeId,
): TrainCore | undefined {
  return (snapshot.train ?? []).find((core) => core.charge === charge);
}

/** Every projectile in flight, as `snapshot().projectiles` reports them. */
export function projectiles(snapshot: VoluteSnapshot): ProjectileView[] {
  return snapshot.projectiles ?? [];
}

/** How many projectiles are in flight. */
export function projectileCount(snapshot: VoluteSnapshot): number {
  return projectiles(snapshot).length;
}

/* -------------------------------------------------------------------------- */
/* The channel's geometry                                                     */
/* -------------------------------------------------------------------------- */
//
// Computed from the twelve vertices `specs/channel.md` lists, by the rule that
// file states, so a check can say where an arc position IS without asking the
// build. That is the point: `channel/arc-position` compares the field point the
// build reports for an arc position against the point the specification puts it
// at, and a shot is aimed at a place on the channel the same way.

/** The leg an arc position lies on: the greatest start arc not exceeding `s`. */
function legFor(s: number): number {
  const last = CHANNEL.length - 2;
  if (!(s > 0)) return 0;
  for (let i = last; i >= 0; i -= 1) {
    if (s >= CHANNEL_ARC[i]) return i;
  }
  return 0;
}

/**
 * The field point at arc position `s`, as `specs/channel.md` walks it:
 * `point = leg.start + leg.direction x (s - a)`.
 *
 * "An arc position below `0` selects the first leg as well: its point is the
 * inlet", and at `PATH_LENGTH` the final leg is the one selected.
 */
export function channelPoint(s: number): Point {
  const leg = legFor(s);
  const from = CHANNEL[leg];
  const to = CHANNEL[leg + 1];
  const length = CHANNEL_ARC[leg + 1] - CHANNEL_ARC[leg];
  const along = Math.max(0, s) - CHANNEL_ARC[leg];
  return {
    x: from.x + ((to.x - from.x) / length) * along,
    y: from.y + ((to.y - from.y) / length) * along,
  };
}

/** `forward(s)`: the unit direction of the leg the same rule selects. */
export function channelForward(s: number): Point {
  const leg = legFor(s);
  const from = CHANNEL[leg];
  const to = CHANNEL[leg + 1];
  const length = CHANNEL_ARC[leg + 1] - CHANNEL_ARC[leg];
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/**
 * The aim, in degrees, that points the injector at a field point.
 *
 * "every angle is in degrees measured from `+x` and increasing toward `+y`", so
 * this is `atan2` in the field's own convention, normalized into `[0, 360)`.
 */
export function aimAt(target: Point, from: Point = INJECTOR): number {
  const degrees =
    (Math.atan2(target.y - from.y, target.x - from.x) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/**
 * The signed shortest turn from one bearing to another, in degrees.
 *
 * Negative counter-clockwise, positive clockwise, always in `(-180, 180]`. What a
 * check reads a turn with rather than subtracting two bearings, because
 * `specs/injector.md` wraps the aim "continuously through a full turn" — so a
 * turn that crosses the seam between 359 and 0 is still one small turn, and a
 * bare subtraction would call it a large one.
 */
export function signedTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** A field point `units` from `from` along `angleDegrees`. */
export function alongAim(
  angleDegrees: number,
  units: number,
  from: Point = INJECTOR,
): Point {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: from.x + Math.cos(radians) * units,
    y: from.y + Math.sin(radians) * units,
  };
}

/**
 * A spaced list of cores for `poseTrain`, head first.
 *
 * `charges[0]` takes `headS` and each one after it sits {@link SPACING} behind
 * the one before, which is what makes the list ONE segment: "A **segment** is a
 * maximal run of consecutive cores in the train whose arc positions differ by
 * exactly `SPACING`". A `marks` entry is the mark of the core at the same index.
 */
export function spacedRun(
  headS: number,
  runCharges: readonly ChargeId[],
  marks: readonly (MachineryKind | null)[] = [],
): PosedCore[] {
  return runCharges.map((charge, index) => [
    headS - index * SPACING,
    charge,
    marks[index] ?? null,
  ]);
}

/** `count` cores of one charge, spaced into one segment with its head at `headS`. */
export function spacedBlock(
  headS: number,
  count: number,
  charge: ChargeId,
): PosedCore[] {
  return spacedRun(
    headS,
    Array.from({ length: count }, () => charge),
  );
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */
//
// WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one
// cue per event, played on the tick its event happens, and says nothing at all
// about how a build makes a sound — under this engine the whole audio layer is
// the build's. So the injected audio probe watches the two doors a browser can
// emit sound through (a Web Audio source being `start()`ed, whatever kind it is,
// and an `<audio>` element being played) and counts what goes through them; the
// harness brackets each driven tick around that count, so a sound is attributed
// to the tick that produced it. A cue made of a tone and a noise burst counts as
// two, which is why a check asserts that a tick sounded rather than how many
// times: the number of sources is the build's business and the specification
// never fixed it.
//
// WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
// game asks the bus for a cue by name and the bus announces it, so a build that
// plays its extraction cue on every shot is caught. There is no bus here to ask,
// so these checks confirm that a sound was emitted and on which tick, and a
// reviewer decides by ear whether the fifteen are told apart. That is a real
// reduction, and the alternative — inferring the cue from the waveform the
// reference happens to use — would grade builds against an implementation rather
// than against the specification.
//
// A POSE SOUNDS NOTHING. "Audio belongs to the ticks. A pose changes the state
// alone and sounds nothing; the cues a scenario hears come from the ticks run
// after it." So a cue raised by `fire()` sounds on the next tick STEPPED, not at
// the call — arrange, then step, then read. {@link watchCues} is the collector,
// and it comes from the kit above.

/**
 * How many sources the build has running that are set to loop, right now.
 *
 * `specs/ui.md` has the two beds "loop until stopped rather than playing once",
 * and "Exactly one of them is looping on `playing`". A build that loops by
 * setting `loop` on its source is read directly here.
 *
 * A build that instead re-schedules the buffer end to end is equally conformant
 * and reports zero, so a check about the bed pairs this with
 * {@link soundsStarted}: a bed that is sounding at all is the weaker reading that
 * every conformant build satisfies.
 */
export function loopingSources(h: Harness): Promise<number> {
  return h.loopingSounds();
}

/** How many sounds the build has emitted since the page loaded. */
export function soundsStarted(h: Harness): Promise<number> {
  return h.sounds();
}

/** How many of the sounds emitted were looping when they started. */
export function loopsStarted(h: Harness): Promise<number> {
  return h.loopStarts();
}

/* -------------------------------------------------------------------------- */
/* Reading a frame back                                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md`: "Volute fixes no palette, no font, no layout, and no styling for
// any screen." So nothing here reads a colour, a contrast, or how far a drawn
// mark reaches. A frame is read against ANOTHER frame of the same hall, through
// the shared package's `differingPoints` re-exported above, and what that reports
// is where the picture changed — which is presence, the one thing a pixel may
// decide.

/** The whole field, read back as RGBA. */
export function fieldPixels(h: Harness): Promise<PixelRect> {
  return h.pixelRect(0, 0, FIELD_W, FIELD_H);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__volute` and then lets the
// real simulation run. `writing-debug-apis-and-validators` puts every COMPOUND
// sequence here rather than on the surface: the surface carries atomic poses, and
// the arrangements a check needs are assembled from them in one place every check
// shares.
//
// A VALIDATOR POSES AN ISOLATED HALL. Everything a check's requirement does not
// concern is removed before its scenario is staged, rather than parked somewhere
// harmless: containment leans on the game's own rules holding, and a broken build
// is broken in exactly those rules. {@link poseHall} is the shape of that — it
// stands the hall on a screen and a level, HOLDS THE INLET with the faculty gate
// `specs/instrumentation.md` requires for it, empties the channel, and puts back
// exactly the cores the requirement is about. Nothing else stands anywhere.
//
// THE INLET IS HELD RATHER THAN STARVED. `setEmission(false)` stops step 7 of the
// tick order and leaves the quota alone, which is why the hall a check poses can
// be genuinely EMPTY: specs/progression.md clears a level "the moment its quota is
// exhausted and no cores remain on the channel", so a hall starved by an exhausted
// quota would leave `playing` on its very next tick unless something were left
// standing on the channel to prevent it. `poseHall` therefore leaves the quota at
// what the level start left it (unexhausted, so the clear condition never fires)
// and holds the inlet instead. A check that IS about the clear names
// `quotaRemaining: 0` for itself; a check that wants the inlet running names
// `emission: true`.

/** What {@link poseHall} arranges. Every field is optional; each defaults below. */
export interface PoseOptions {
  /** The level in play, 1 through 5. Defaults to 1. */
  level?: number;
  /** The screen the hall stands on. Defaults to `playing`. */
  screen?: ScreenName;
  /**
   * Whether the inlet emits. Defaults to `false`, which holds it.
   *
   * A check that wants the inlet running names `true`; a check that does not
   * takes the default, so nothing arrives to join the scenario it posed.
   */
  emission?: boolean;
  /**
   * Whether the train advances. Defaults to `true`, the faculty play gives it.
   *
   * A check whose requirement does not exercise the feed names `false`, and its
   * cores then stand exactly where it posed them.
   */
  feed?: boolean;
  /**
   * The cores the inlet has left to emit. Defaults to the level's full quota.
   *
   * The default is what keeps an EMPTY hall in play: an exhausted quota over an
   * empty channel is a cleared level. A check about the clear names `0`.
   */
  quotaRemaining?: number;
  /** The pressure. Defaults to 0, the value a level starts at. */
  pressure?: number;
  /** The chain step. Defaults to 1, the value a level starts at. */
  chainStep?: number;
  /** The score. Defaults to 0, the value a run starts at. */
  score?: number;
  /** The cells remaining. Defaults to `CELLS`, the value a run starts at. */
  cells?: number;
  /** The cores to put on the channel. Defaults to none. */
  cores?: readonly PosedCore[];
  /** The charge the injector holds loaded. Defaults to {@link DEFAULT_LOADED}. */
  loaded?: ChargeId;
  /** The charge the injector holds queued. Defaults to {@link DEFAULT_QUEUED}. */
  queued?: ChargeId;
  /** The aim, in degrees. Defaults to the opening aim of 270. */
  aim?: number;
  /** A timed machinery to grant once the hall is posed. */
  machinery?: TimedMachineryKind;
}

/**
 * The charges the injector holds when a check names none.
 *
 * Posed rather than left to the draw, because `specs/channel.md` draws a charge
 * at random "uniformly over the set of distinct charges on the channel" — so
 * what a level opening leaves loaded is whatever the build drew, over a channel
 * `poseHall` then clears. A check that fires reads the charge it fired, and a
 * check that does not is unaffected either way.
 */
export const DEFAULT_LOADED: ChargeId = "olivine";
export const DEFAULT_QUEUED: ChargeId = "garnet";

/**
 * Pose an isolated hall, assembled from single-field poses.
 *
 * Every field is set explicitly, so what stands is exactly what the caller asked
 * for and nothing else: the screen, the level, the two faculty gates, the quota,
 * the pressure, the chain step, the run's score and cells, the channel, the
 * injector, and at most one timed machinery.
 *
 * `clearTrain` runs before `poseTrain` so the channel holds the check's cores
 * alone. `setLevel` runs before `setQuotaRemaining`, which clamps to the level's
 * own quota.
 *
 * Nothing here decides an outcome. Every extraction, score, chain step, grant,
 * cell and clear a check reads comes from the ticks it steps afterwards.
 */
export async function poseHall(
  h: Harness,
  options: PoseOptions = {},
): Promise<void> {
  const level = options.level ?? 1;
  await h.debug.setScreen(options.screen ?? "playing");
  await h.debug.setLevel(level);
  await h.debug.setEmission(options.emission ?? false);
  await h.debug.setFeed(options.feed ?? true);
  await h.debug.setQuotaRemaining(
    options.quotaRemaining ?? levelSpec(level).quota,
  );
  await h.debug.setPressure(options.pressure ?? 0);
  await h.debug.setChainStep(options.chainStep ?? 1);
  await h.debug.setScore(options.score ?? 0);
  await h.debug.setCells(options.cells ?? CELLS);
  await h.debug.clearTrain();
  if (options.cores !== undefined && options.cores.length > 0) {
    await h.debug.poseTrain(options.cores);
  }
  await h.debug.setLoaded(options.loaded ?? DEFAULT_LOADED);
  await h.debug.setQueued(options.queued ?? DEFAULT_QUEUED);
  await h.debug.setAim(options.aim ?? OPENING_AIM);
  if (options.machinery !== undefined) {
    await h.debug.grantMachinery(options.machinery);
  }
}

/**
 * Open a run from the title exactly as the start control does, and open `level`.
 *
 * `specs/instrumentation.md` no longer carries a compound `start`: the start
 * control poses the score `0`, the cells at `CELLS` (`3`), and level `1` opened
 * exactly as `startLevel` opens it, and assembling that sequence from the
 * single-field poses is the harness's job rather than the surface's. A `level`
 * beyond 1 is opened after it, which leaves the score and the cells alone.
 */
export async function startRun(h: Harness, level = 1): Promise<void> {
  await h.debug.setScore(0);
  await h.debug.setCells(CELLS);
  await h.debug.startLevel(1);
  if (level !== 1) await h.debug.startLevel(level);
}

/**
 * Aim at `angleDegrees` and release the loaded core along it.
 *
 * Two atomic poses: `setAim` turns the barrel and releases nothing, and `fire()`
 * releases along the aim it finds. `fire()` always launches — "Any cooldown
 * outstanding at the call is cleared first" — so this is how a check that is not
 * ABOUT the cooldown gets a projectile into the hall. A check that IS about the
 * cooldown raises the fire CONTROL instead, with {@link pressFire}, which honours
 * it. A check that wants the aim POSED and no projectile calls `setAim` alone.
 */
export async function fireAt(h: Harness, angleDegrees: number): Promise<void> {
  await h.debug.setAim(angleDegrees);
  await h.debug.fire();
}

/** Aim at a field point and release the loaded core toward it. */
export async function fireToward(h: Harness, target: Point): Promise<void> {
  await fireAt(h, aimAt(target));
}

/** Raise the fire control itself, which honours the cooldown. One tick passes. */
export function pressFire(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("Space");
}

/** Raise the swap control. One tick passes. */
export function pressSwap(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("KeyX");
}

/** Raise the confirm control: starts a run on the title, dismisses an ending. */
export function pressConfirm(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("Enter");
}

/**
 * Raise the pause control on `Escape`, which pauses and resumes. One tick passes.
 *
 * `specs/controls.md` ("Pausing") binds pause to two interchangeable keys, so the
 * key is taken from `BINDINGS.pause` rather than spelled here, and
 * {@link pressPauseAlt} raises the same control on the other one.
 */
export function pressPause(h: Harness): Promise<VoluteSnapshot> {
  return h.tap(BINDINGS.pause[0]);
}

/** Raise the pause control on `KeyP`, its second key. One tick passes. */
export function pressPauseAlt(h: Harness): Promise<VoluteSnapshot> {
  return h.tap(BINDINGS.pause[1]);
}

/** Raise the mute control. One tick passes. */
export function pressMute(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("KeyM");
}

/**
 * Step until the projectile the check fired has left the hall, and say what
 * happened.
 *
 * A shot resolves in one of three ways — it seats, it leaves the field, or it is
 * still flying — and a check that drove one wants to know which without spelling
 * the sweep out. `seated` is the core count rising, which is what an insertion
 * that did not immediately extract leaves; a check about the extraction reads the
 * train instead.
 */
export interface ShotResult {
  /** Whether every projectile is gone. */
  landed: boolean;
  /** Ticks stepped before the sweep ended. */
  ticks: number;
  snapshot: VoluteSnapshot;
}

/** Step until no projectile remains, or `maxTicks` have passed. */
export async function driveShot(
  h: Harness,
  maxTicks = 120,
): Promise<ShotResult> {
  const swept = await h.stepUntil(
    (snapshot) => (snapshot.projectiles?.length ?? 0) === 0,
    { maxTicks, poll: 1 },
  );
  return { landed: swept.hit, ticks: swept.ticks, snapshot: swept.snapshot };
}

/**
 * The straight top run of the channel, which is where most insertion scenarios
 * are posed.
 *
 * Leg 0 runs from the inlet `(40, 40)` to `(920, 40)`, so an arc position on it
 * puts a core at `y = 40` with forward pointing along `+x` — the one place on the
 * channel where "ahead" and "larger x" are the same statement, which is what
 * `insertion/insert-ahead` and `insertion/insert-behind` turn on. The injector at
 * `(420, 330)` sits below it, so a shot fired near 270 degrees crosses it.
 */
export const TOP_RUN = {
  /** The arc position at the start of the leg. */
  fromS: CHANNEL_ARC[0],
  /** The arc position at the end of the leg. */
  toS: CHANNEL_ARC[1],
  /** The `y` every core on the leg sits at. */
  y: CHANNEL[0].y,
  /** The forward direction along the leg. */
  forward: { x: 1, y: 0 } as Point,
} as const;

/** The arc position on the top run directly above a field `x`. */
export function topRunS(x: number): number {
  return x - CHANNEL[0].x;
}

/** Where the whole channel runs, for a check that has to place a core off it. */
export const CHANNEL_END_S = PATH_LENGTH;

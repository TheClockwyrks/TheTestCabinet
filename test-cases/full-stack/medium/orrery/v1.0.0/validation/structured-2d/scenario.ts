// Orrery — the compound sequences every suite shares. CASE-PROVIDED, and the SAME
// FILE in all three engine projects.
//
// COMPOUND OPERATIONS BELONG TO THE VALIDATORS, NOT TO THE DEBUG SURFACE
// (`guides/authoring/writing-debug-apis-and-validators.md`). `specs/instrumentation.md`
// carries fifty-three operations and every one of them sets ONE thing; arranging
// several of them — opening a run on a posed challenge, clearing the field down to
// one mote, dragging a part out of the tray — is a sequence, and a sequence lives
// here where every check shares it.
//
// NOTHING A CHECK DID NOT ASK FOR HAPPENS. Each helper below is written so that a
// check wanting all of a sequence calls the helper and a check wanting part of it
// calls the atomic operations. {@link openBareRun} is the one every isolated
// scenario opens with, and it is deliberately spelled out call by call: a check
// that wants the completion switch left ON calls {@link openRun} instead, and one
// that wants the challenge's own machine left standing calls
// {@link openChallengeDocument} and starts the run itself.
//
// A HELPER THAT POSES ANYTHING A READING DERIVES FROM RECONCILES BEFORE IT
// RETURNS. `specs/instrumentation.md` lets a build work the cost, the period, a
// mote's drawn position, the banked area and each mode's counts out at the read
// OR keep any of them as a stored copy, and `reconcile()` is what brings a stored
// copy back into agreement with a world that has just been posed. So every helper
// below that writes parts, tapes, motes, grips or live poses ends with the call,
// and a check reaching its scenario through the helpers never makes it itself. A
// check that poses with `h.debug.set…` directly calls `reconcile()` once before
// its first read or sweep. A helper that writes only state nothing is derived from
// — a pause, a speed step, the completion switch — does not, and neither do the
// pointer and action helpers, which drive the build's own input path.
//
// EVERY HELPER IS WRITTEN AGAINST {@link Driven}, WHICH IS A SLICE OF A HARNESS
// RATHER THAN A HARNESS. That is what lets one file serve all three projects: each
// project's `Harness` satisfies this slice structurally, and `harness.ts`
// re-exports everything here, so a suite says `from "../harness"` and never learns
// that this file exists.

import {
  BINDINGS,
  FRAMES_PER_CYCLE,
  OVERLAY_KEY,
  SPEEDS,
  type ActionName,
  type InstructionName,
  type MoteName,
  type PartName,
} from "./constants";
import type { OrreryDriver } from "./driver";
import {
  hexCenter,
  regionCenter,
  traySlot,
  type Hex,
  type Region,
  type StagePoint,
} from "./field";
import type { Challenge, Solution, SolutionPart } from "./formats";
import { lastMoteId, lastPartId, type OrrerySnapshot } from "./snapshot";

/* -------------------------------------------------------------------------- */
/* What a scenario helper needs of a harness                                  */
/* -------------------------------------------------------------------------- */

/** A sound the build emitted, and the frame of the drive it sounded on. */
export interface TimedCue {
  /** The frame it sounded on, 1-based, as `Harness.frame()` counts them. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
  /**
   * The cue's name, where the runtime announces one, and `null` where it does
   * not.
   *
   * Under either ENGINE the game asks the cue bus for a cue by name and the bus
   * announces it, so this is one of the seven names in `CUES`. Under NO ENGINE
   * the whole audio layer is the build's own and there is no bus to ask: the
   * harness watches the doors a browser emits sound through and counts what goes
   * through them, so a cue is known to have SOUNDED and to have sounded on this
   * frame, and its name is `null`. See {@link cuesOf} for what a portable check
   * does with that.
   */
  cue: string | null;
  /**
   * Whether the cue started LOOPING rather than playing once.
   *
   * Under either engine this is the bus's own `cue:looped`. Under no engine it is
   * always `false`: the probe sees a source start and cannot say whether it was
   * scheduled to repeat, so the engineless reading of a loop is
   * `Harness.loopingSounds()` and `Harness.loopStarts()`.
   */
  looping: boolean;
}

/** How far a sweep may run, and how many frames separate two samples. */
export interface UntilOptions {
  /** The bound, in frames. Defaults to a generous few seconds of game time. */
  maxFrames?: number;
  /** How many frames to run between two samples of the predicate. */
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  /**
   * Whether the predicate ever held.
   *
   * READ IT. A sweep that ran out of frames answers `false` and hands back the
   * last snapshot it took, so a check that reads the snapshot and never reads
   * this asserts against a state the sweep never reached — and against a build
   * that does nothing at all it commonly asserts against the state it started
   * from, which is how a point ends up decided by accident. Every check that
   * sweeps asserts on `hit` before it reads anything else.
   */
  hit: boolean;
  /** Frames run before the sample that ended the sweep. */
  frames: number;
  snapshot: OrrerySnapshot;
}

/**
 * The slice of a harness a scenario helper drives.
 *
 * Declared structurally rather than imported, so this one file serves all three
 * projects. Every member is a METHOD rather than a property holding a function,
 * because method parameters are bivariant: a project's own `Harness`, whose
 * `snapshot` answers the same type but whose other members carry more, is
 * assignable to this.
 */
export interface Driven {
  /** The surface, driven: one member per row of `specs/instrumentation.md`. */
  readonly debug: OrreryDriver;
  /** Where {@link watchCues} attaches: one array per watcher. */
  readonly cues: TimedCue[][];
  /** The frames this harness has driven, 1-based. */
  frame(): number;
  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<OrrerySnapshot>;
  /** Run `frames` frames at the harness's own clock. */
  advance(frames?: number): Promise<void>;
  /** Run `frames` whole frames covering exactly `seconds` of game time. */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
  /** Press a key and leave it down. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /** Press a key, run the one frame that delivers it, and release it. */
  tap(code: string): Promise<OrrerySnapshot>;
  /** Advance until `predicate` holds. */
  until(
    predicate: (snapshot: OrrerySnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Collect every sound the build emits from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * Call it at the moment a check's window opens; the array fills as frames run.
 */
export function watchCues(h: Driven): TimedCue[] {
  const played: TimedCue[] = [];
  h.cues.push(played);
  return played;
}

/**
 * The cues of `played` that are `cue`.
 *
 * READ THIS BEFORE USING IT. Under either engine the cue bus announces a name and
 * this filters by it, which is the strongest reading there is. Under NO ENGINE
 * there is no bus and every cue's name is `null`, so this answers EVERY sound in
 * the window — which is the strongest reading THERE is, and the reason an
 * engineless check fences its window with silence (a stretch of frames either
 * side in which nothing is expected to sound) rather than leaning on the name.
 * One suite text then means the strongest thing each engine can observe, which is
 * the honest reading on all three; inferring a cue from the waveform a reference
 * happens to use would grade builds against an implementation.
 */
export function cuesOf(played: readonly TimedCue[], cue: string): TimedCue[] {
  return played.filter((entry) => entry.cue === null || entry.cue === cue);
}

/** The cues of `played` that sounded on one frame. */
export function cuesOnFrame(
  played: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return played.filter((entry) => entry.frame === frame);
}

/** Whether any sound at all reached `played` between two frames, both ends in. */
export function soundedBetween(
  played: readonly TimedCue[],
  first: number,
  last: number,
): boolean {
  return played.some((entry) => entry.frame >= first && entry.frame <= last);
}

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How many seconds of game time one cycle takes at the run's current speed:
 * a run "advances the fraction by `SPEEDS[sim.speed] * dt` cycles"
 * (`specs/simulation.md`), so a cycle is `1 / SPEEDS[speed]` seconds.
 */
export function secondsPerCycle(speed: number): number {
  const rate = SPEEDS[speed] ?? SPEEDS[0];
  return 1 / (rate as number);
}

/**
 * Run exactly `cycles` whole cycles of game time, at the speed the run is set to.
 *
 * The span is computed from `sim.speed` as the snapshot reports it, so a check
 * that changed the speed gets the cycles it asked for rather than the cycles the
 * default speed would have run. `frames` divides the span; the default gives each
 * cycle `FRAMES_PER_CYCLE` frames, which is what makes a replay of a cycle
 * watchable. The span is the same however it is divided
 * (`specs/instrumentation.md`), so nothing the run decides turns on the division.
 *
 * A run that is paused, faulted or complete advances no fraction
 * (`specs/simulation.md`), so this runs the frames and the cycle counter stays —
 * which is exactly what a check about pausing asserts.
 */
export async function advanceCycles(
  h: Driven,
  cycles: number,
  frames?: number,
): Promise<void> {
  const speed = (await h.snapshot()).sim?.speed ?? 0;
  const count = frames ?? Math.max(1, Math.round(cycles * FRAMES_PER_CYCLE));
  await h.advanceSeconds(cycles * secondsPerCycle(speed), count);
}

/**
 * Run exactly `fraction` of one cycle of game time, in ONE frame by default.
 *
 * What a check about a mid-cycle moment drives: the eight collision sample
 * fractions `k / 8`, the drawn position of a carried mote at `sim.fraction`, the
 * moment a pause froze the fraction at. One frame by default because a fraction
 * is a moment rather than a stretch, and because a single frame of exactly the
 * right length lands on the fraction precisely whatever the speed.
 */
export function advanceFraction(
  h: Driven,
  fraction: number,
  frames = 1,
): Promise<void> {
  return h
    .snapshot()
    .then((snapshot) =>
      h.advanceSeconds(
        fraction * secondsPerCycle(snapshot.sim?.speed ?? 0),
        frames,
      ),
    );
}

/** Run frames until the run's status is anything but `running`, or the bound runs out. */
export function untilSettled(
  h: Driven,
  options?: UntilOptions,
): Promise<UntilResult> {
  return h.until(
    (snapshot) => snapshot.sim === null || snapshot.sim.status !== "running",
    options,
  );
}

/** Run frames until the run has completed `cycles` whole cycles, or the bound runs out. */
export function untilCycle(
  h: Driven,
  cycle: number,
  options?: UntilOptions,
): Promise<UntilResult> {
  return h.until((snapshot) => (snapshot.sim?.cycle ?? -1) >= cycle, options);
}

/* -------------------------------------------------------------------------- */
/* The keyboard                                                               */
/* -------------------------------------------------------------------------- */

/** The first key `specs/controls.md` binds to an action. */
export function keyFor(action: ActionName): string {
  const codes = BINDINGS[action];
  const first = codes[0];
  if (first === undefined) {
    throw new Error(`Orrery: specs/controls.md binds no key to "${action}"`);
  }
  return first;
}

/**
 * Fire one registered action, through a real key press and the frame that
 * delivers it.
 *
 * The press goes through the runtime's own keyboard rather than through the
 * surface, which carries no operation for the registered actions at all: the
 * menus and the editor's verbs are driven exactly the way a player drives them.
 *
 * TWO ACTIONS SHARE A PHYSICAL KEY, BY SPECIFICATION: `part-grow`/`ins-extend` on
 * `KeyW` and `part-shrink`/`ins-retract` on `KeyS`. Pressing either name presses
 * that key, and the editor's FOCUS is what decides which action the game reads
 * (`specs/controls.md`), so a check that wants one of a pair sets the focus first.
 */
export function pressAction(
  h: Driven,
  action: ActionName,
): Promise<OrrerySnapshot> {
  return h.tap(keyFor(action));
}

/** Hold an action's key down, without running a frame. */
export function holdAction(h: Driven, action: ActionName): Promise<void> {
  return h.hold(keyFor(action));
}

/** Release an action's key. */
export function releaseAction(h: Driven, action: ActionName): Promise<void> {
  return h.release(keyFor(action));
}

/** Show or hide the debug overlay, through its fixed `Backquote` binding. */
export function toggleOverlay(h: Driven): Promise<OrrerySnapshot> {
  return h.tap(OVERLAY_KEY);
}

/* -------------------------------------------------------------------------- */
/* The pointer                                                                */
/* -------------------------------------------------------------------------- */
//
// `specs/instrumentation.md`: "Each of the three pointer operations takes effect
// immediately, when it is called, rather than being sampled once per frame", and
// they "feed the same input path the player's pointer feeds: targeting,
// selection, drags, lays, and the focus rule all run as `specs/editor.md` and
// `specs/controls.md` state." So a whole machine is built from code without a
// frame passing, and a check drives a frame only where something is genuinely
// per-frame: a render to sample, or a cue to hear.

/** Press at a logical stage position. Takes effect at the call. */
export function pressAt(h: Driven, at: StagePoint): Promise<void> {
  return h.debug.pointerDown(at.x, at.y);
}

/** Move the pressed pointer to a logical stage position. Takes effect at the call. */
export function moveTo(h: Driven, at: StagePoint): Promise<void> {
  return h.debug.pointerMove(at.x, at.y);
}

/** Release the pointer. Takes effect at the call. */
export function releasePointer(h: Driven): Promise<void> {
  return h.debug.pointerUp();
}

/** Press and release at one point: the gesture that selects, or takes a tray slot. */
export async function clickAt(h: Driven, at: StagePoint): Promise<void> {
  await h.debug.pointerDown(at.x, at.y);
  await h.debug.pointerUp();
}

/**
 * A whole drag, as one call: a press at `from`, a move onto each of `via` in
 * order, a move to `to`, and a release.
 *
 * `via` is what a LAY needs — "moving the pointer onto a hex adjacent to the live
 * end appends it to the path" (`specs/editor.md`), so a track is laid by visiting
 * every cell rather than by jumping to the last — and what a check about a drag's
 * ghost retargeting on each move needs. A plain place-or-move drag names no `via`.
 */
export async function drag(
  h: Driven,
  from: StagePoint,
  to: StagePoint,
  via: readonly StagePoint[] = [],
): Promise<void> {
  await h.debug.pointerDown(from.x, from.y);
  for (const point of via) await h.debug.pointerMove(point.x, point.y);
  await h.debug.pointerMove(to.x, to.y);
  await h.debug.pointerUp();
}

/** {@link drag}, addressed in hexes: the centres of the hexes named. */
export function dragHex(
  h: Driven,
  from: Hex,
  to: Hex,
  via: readonly Hex[] = [],
): Promise<void> {
  return drag(h, hexCenter(from), hexCenter(to), via.map(hexCenter));
}

/**
 * Take tray entry `slot` and drop it on a hex: the gesture that places a part
 * the way a player places one (`specs/editor.md`, Dragging, "From the tray").
 *
 * The press lands in the middle of the entry's rectangle and the release on the
 * hex's centre. The ghost opens "at rotation `0` and length `1`"; a check that
 * wants another pose turns the ghost with `part-cw` and `part-grow` between the
 * press and the release, which is what {@link dragFromTray}'s `while` runs.
 */
export async function dragFromTray(
  h: Driven,
  slot: number,
  to: Hex,
  options: { via?: readonly Hex[]; while?: () => Promise<void> } = {},
): Promise<void> {
  const start = regionCenter(traySlot(slot));
  await h.debug.pointerDown(start.x, start.y);
  for (const hex of options.via ?? []) {
    const point = hexCenter(hex);
    await h.debug.pointerMove(point.x, point.y);
  }
  const end = hexCenter(to);
  await h.debug.pointerMove(end.x, end.y);
  await options.while?.();
  await h.debug.pointerUp();
}

/** The middle of a rectangle, so a check presses "the tray's third entry". */
export function centerOf(region: Region): StagePoint {
  return regionCenter(region);
}

/* -------------------------------------------------------------------------- */
/* Opening a screen                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Put the game back to the title screen, and draw one frame of it.
 *
 * `reset` "restores every declared field of the game's state to its title-screen
 * value" (`specs/instrumentation.md`), and the frame after it is what puts the
 * title on the canvas, so a check can sample pixels right away.
 */
export async function openTitle(h: Driven): Promise<void> {
  await h.debug.reset();
  await h.advance(1);
}

/** Show the how-to, at page `0`, and draw one frame of it. */
export async function openHowto(h: Driven): Promise<void> {
  await h.debug.setScreen("howto");
  await h.advance(1);
}

/** Show a mode's select screen, and draw one frame of it. */
export async function openSelect(
  h: Driven,
  mode: "campaign" | "extras",
): Promise<void> {
  await h.debug.setMode(mode);
  await h.debug.setScreen("select");
  await h.advance(1);
}

/**
 * Open a SHIPPED challenge in the editor, and draw one frame of it.
 *
 * "The open challenge becomes that mode's shipped challenge at `index`, and the
 * game moves to the editor with an empty machine, empty histories, no run, and
 * the tray derived from the challenge" (`specs/instrumentation.md`). Progress is
 * untouched, and "a locked row opens like any other".
 */
export async function openChallenge(
  h: Driven,
  mode: "campaign" | "extras",
  index: number,
): Promise<void> {
  await h.debug.openChallenge(mode, index);
  await h.debug.reconcile();
  await h.advance(1);
}

/**
 * Open a challenge DOCUMENT in the editor, and draw one frame of it.
 *
 * The same editor state `openChallenge` leaves, with `source` reported as
 * `"custom"`. This is how an isolated scenario reaches a world of exactly the
 * shape it needs without depending on a single figure of the build's own course.
 */
export async function openChallengeDocument(
  h: Driven,
  document: Challenge,
): Promise<void> {
  await h.debug.loadChallenge(document);
  await h.debug.reconcile();
  await h.advance(1);
}

/** Replace the open challenge's machine with a solution document. */
export async function loadMachine(
  h: Driven,
  document: Solution,
): Promise<void> {
  await h.debug.loadSolution(document);
  await h.debug.reconcile();
}

/* -------------------------------------------------------------------------- */
/* Opening a run                                                              */
/* -------------------------------------------------------------------------- */

/** What {@link openBareRun} and {@link openRun} take. */
export interface RunOptions {
  /** The challenge to pose. */
  challenge: Challenge;
  /** A machine to load before the run starts. Defaults to none: an empty field. */
  machine?: Solution;
  /** The speed step the run is set to before any frame runs. */
  speed?: number;
  /** Whether to leave the run PAUSED, so nothing advances until a check says so. */
  paused?: boolean;
}

/**
 * The opener almost every isolated check uses: a posed challenge, an empty
 * machine, the completion switch held OFF, a live run, and an EMPTY FIELD.
 *
 * This is the sequence `specs/instrumentation.md` itself describes — "a typical
 * scenario calls `reset()`, `loadChallenge` to pose a small challenge,
 * `clearMachine()`, `setCompletion(false)`, `startRun()`, and `clearMotes()`" —
 * spelled out call by call so a check that wants a different one of them can be
 * written from the same parts.
 *
 * WHY THE COMPLETION SWITCH IS OFF. Completion is "the game's one autonomous
 * consequence": a boundary that satisfies every target ends the run, records the
 * metrics, marks the challenge solved and unlocks what its mode unlocks. A check
 * about a sigil, an instruction or a collision is about none of that, and a run
 * that completed under it would stop advancing part way through the scenario. A
 * check that IS about completion opens with {@link openRun} instead.
 *
 * WHY THE FIELD IS EMPTIED. `clearMotes` "removes every mote, fixtures included,
 * and with them every filament and every grip", so what is on the field after
 * this is exactly what the check spawns back. A wheel's six fixtures are motes
 * like any other and go with them, which is the faculty gate
 * `specs/instrumentation.md` names for a wheel's fixtures.
 */
export async function openBareRun(
  h: Driven,
  options: RunOptions,
): Promise<void> {
  await h.debug.reset();
  await h.debug.loadChallenge(options.challenge);
  await h.debug.clearMachine();
  if (options.machine !== undefined) {
    await h.debug.loadSolution(options.machine);
  }
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  if (options.speed !== undefined) await h.debug.setSpeed(options.speed);
  if (options.paused === true) await h.debug.setPaused(true);
  await h.debug.reconcile();
}

/**
 * The same opener with the completion switch left ON and the field left as
 * `startRun` raised it: a run exactly as a player's `play` action would begin
 * one, on a posed challenge.
 *
 * What a check about the completion test, the metrics, the records, the solved
 * sets, or a mode's unlocking opens with.
 */
export async function openRun(h: Driven, options: RunOptions): Promise<void> {
  await h.debug.reset();
  await h.debug.loadChallenge(options.challenge);
  await h.debug.clearMachine();
  if (options.machine !== undefined) {
    await h.debug.loadSolution(options.machine);
  }
  await h.debug.startRun();
  if (options.speed !== undefined) await h.debug.setSpeed(options.speed);
  if (options.paused === true) await h.debug.setPaused(true);
  await h.debug.reconcile();
}

/**
 * Empty the world without starting over: every part off the machine, and every
 * mote, filament and grip off the field.
 *
 * The one-line "clear the world" a check calls between two scenarios in one
 * suite. `clearMotes` needs a live run and does nothing here without one, so with
 * no run live this clears the machine alone — which is the whole of the world
 * while editing.
 */
export async function clearWorld(h: Driven): Promise<void> {
  await h.debug.clearMachine();
  const snapshot = await h.snapshot();
  if (snapshot.sim !== null) await h.debug.clearMotes();
  await h.debug.reconcile();
}

/* -------------------------------------------------------------------------- */
/* Placing exactly one of something                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these makes one placement through the surface and answers the new
// part's or mote's id, which `specs/instrumentation.md` fixes as "the `id` of the
// last entry of `editor.parts`" and "of `sim.motes` in the next snapshot". The
// read is the price of the identity: a check that placed three parts and wants
// the second one's id has it from the call that placed it, rather than by
// guessing at a numbering the specification never fixed.

/** Place one arm, wheel or transforming sigil, and answer its id. */
export async function placePart(
  h: Driven,
  kind: PartName,
  hex: Hex,
  rotation = 0,
): Promise<number> {
  await h.debug.placePart(kind, hex.q, hex.r, rotation);
  await h.debug.reconcile();
  return newPartId(await h.snapshot(), `placePart(${kind})`);
}

/** Place the rise for reagent `index`, and answer its id. */
export async function placeRise(
  h: Driven,
  index: number,
  hex: Hex,
  rotation = 0,
): Promise<number> {
  await h.debug.placeRise(index, hex.q, hex.r, rotation);
  await h.debug.reconcile();
  return newPartId(await h.snapshot(), `placeRise(${index})`);
}

/** Place the set for product `index`, and answer its id. */
export async function placeSet(
  h: Driven,
  index: number,
  hex: Hex,
  rotation = 0,
): Promise<number> {
  await h.debug.placeSet(index, hex.q, hex.r, rotation);
  await h.debug.reconcile();
  return newPartId(await h.snapshot(), `placeSet(${index})`);
}

/**
 * Lay a whole track in one call: a one-cell track on the first hex, extended to
 * each of the rest in order, and closed into a loop when `closed` is asked for.
 *
 * Answers the track's id. `specs/instrumentation.md` gives one operation per step
 * — `placeTrack`, `extendTrack`, `closeTrack` — and this is the sequence; a check
 * about one of the three calls it directly.
 */
export async function placeTrack(
  h: Driven,
  cells: readonly Hex[],
  closed = false,
): Promise<number> {
  const first = cells[0];
  if (first === undefined) {
    throw new Error("Orrery: placeTrack needs at least one cell, got none");
  }
  await h.debug.placeTrack(first.q, first.r);
  await h.debug.reconcile();
  const id = newPartId(await h.snapshot(), "placeTrack");
  for (const cell of cells.slice(1)) {
    await h.debug.extendTrack(id, cell.q, cell.r);
  }
  if (closed) await h.debug.closeTrack(id);
  await h.debug.reconcile();
  return id;
}

/** Spawn one unbonded, unheld mote, and answer its id. */
export async function spawnMote(
  h: Driven,
  hex: Hex,
  type: MoteName,
): Promise<number> {
  await h.debug.spawnMote(hex.q, hex.r, type);
  await h.debug.reconcile();
  return newMoteId(await h.snapshot(), `spawnMote(${type})`);
}

/**
 * Spawn a whole constellation: one mote per entry, then one filament per link,
 * and answer the ids in the order the motes were named.
 *
 * `links` names its ends by INDEX into `motes`, so a fixture reads as a shape
 * rather than as a sequence of ids nothing has yet.
 */
export async function spawnConstellation(
  h: Driven,
  motes: readonly { hex: Hex; type: MoteName }[],
  links: readonly { a: number; b: number; weight?: number }[] = [],
): Promise<number[]> {
  const ids: number[] = [];
  for (const entry of motes)
    ids.push(await spawnMote(h, entry.hex, entry.type));
  for (const edge of links) {
    const a = ids[edge.a];
    const b = ids[edge.b];
    if (a === undefined || b === undefined) {
      throw new Error(
        `Orrery: spawnConstellation link (${edge.a}, ${edge.b}) names a mote that was not spawned`,
      );
    }
    await h.debug.linkMotes(a, b, edge.weight ?? 1);
  }
  await h.debug.reconcile();
  return ids;
}

/** Write a whole tape, one call per cell, from column `0`. */
export async function writeTape(
  h: Driven,
  part: number,
  cells: readonly (InstructionName | null)[],
): Promise<void> {
  for (const [col, cell] of cells.entries()) {
    await h.debug.setTapeCell(part, col, cell);
  }
  await h.debug.reconcile();
}

/** The id of the part placed last, or a thrown error naming the call that failed. */
function newPartId(snapshot: OrrerySnapshot, doing: string): number {
  const id = lastPartId(snapshot);
  if (id === null) {
    throw new Error(
      `Orrery: ${doing} left the machine empty, so there is no new part id — ` +
        "specs/instrumentation.md makes a new part's id the id of the last " +
        "entry of editor.parts in the next snapshot",
    );
  }
  return id;
}

/** The id of the mote spawned last, or a thrown error naming the call that failed. */
function newMoteId(snapshot: OrrerySnapshot, doing: string): number {
  const id = lastMoteId(snapshot);
  if (id === null) {
    throw new Error(
      `Orrery: ${doing} left the field empty, so there is no new mote id — ` +
        "specs/instrumentation.md makes a new mote's id the id of the last " +
        "entry of sim.motes in the next snapshot",
    );
  }
  return id;
}

/* -------------------------------------------------------------------------- */
/* The faculty gates                                                          */
/* -------------------------------------------------------------------------- */
//
// `specs/instrumentation.md` tabulates one gate per faculty, and every one of
// them is here under the name of the faculty rather than of the operation, so a
// check reads as the isolation it is asking for: "hold this arm's motion still,
// and exercise its grip."

/**
 * Hold a part's MOTION still, leaving every other faculty exercised.
 *
 * The gate the specification names: "Leaving its tape cell for the cycle blank,
 * which every part rests on." Blanking the whole tape holds it still for every
 * cycle, and a blank cell "is a rest on every part, a wheel included, and never
 * faults" (`specs/simulation.md`). What the part is HOLDING is untouched: a grip
 * "persists across cycles until dropped".
 */
export async function holdMotion(h: Driven, part: number): Promise<void> {
  const snapshot = await h.snapshot();
  const placed = snapshot.editor.parts.find((entry) => entry.id === part);
  const cells = placed?.tape?.length ?? 0;
  for (let col = 0; col < cells; col += 1) {
    await h.debug.setTapeCell(part, col, null);
  }
  await h.debug.reconcile();
}

/**
 * Give a gripper its hold with no `grab` ever running: the gate's other side.
 *
 * "`setGrip`, which takes hold with no `grab` ever running" — so a check about
 * what a HELD constellation does under a motion poses the hold directly and never
 * runs the cycle that would have taken it.
 */
export async function takeGrip(
  h: Driven,
  part: number,
  spoke: number,
  mote: number,
): Promise<void> {
  await h.debug.setGrip(part, spoke, mote);
  await h.debug.reconcile();
}

/**
 * Hold a gripper's HOLD still: it opens, and nothing on the tape closes it.
 *
 * "`releaseGrip`, and leaving `grab` off the tape."
 */
export async function holdGrip(
  h: Driven,
  part: number,
  spoke: number,
): Promise<void> {
  await h.debug.releaseGrip(part, spoke);
  await h.debug.reconcile();
}

/**
 * Pose a part's LIVE rotation, length and base cell, leaving its REST pose as it
 * stands: the third gate, "which move it with no tape running".
 *
 * Each argument is applied only when it is named, so a check that wants the live
 * rotation moved and the live length left alone names one of them.
 */
export async function posePart(
  h: Driven,
  part: number,
  pose: { rotation?: number; length?: number; cell?: Hex },
): Promise<void> {
  if (pose.rotation !== undefined) {
    await h.debug.setPoseRotation(part, pose.rotation);
  }
  if (pose.length !== undefined) {
    await h.debug.setPoseLength(part, pose.length);
  }
  if (pose.cell !== undefined) {
    await h.debug.setPoseCell(part, pose.cell.q, pose.cell.r);
  }
  await h.debug.reconcile();
}

/**
 * Take a wheel's fixtures off the field, one `removeMote` each: the gate for "a
 * wheel's fixtures".
 *
 * A check that wants a wheel turning with nothing on its ring calls this; one
 * that wants the ring calls nothing, because `startRun` places the six.
 */
export async function clearFixtures(h: Driven, wheel: number): Promise<void> {
  const snapshot = await h.snapshot();
  for (const mote of snapshot.sim?.motes ?? []) {
    if (mote.wheel === wheel) await h.debug.removeMote(mote.id);
  }
  await h.debug.reconcile();
}

/** Hold the run's clock still: `setPaused(true)`. */
export function pauseRun(h: Driven): Promise<void> {
  return h.debug.setPaused(true);
}

/** Let the run's clock run again: `setPaused(false)`. */
export function resumeRun(h: Driven): Promise<void> {
  return h.debug.setPaused(false);
}

/** Hold the completion test off: the switch `specs/instrumentation.md` names. */
export function holdCompletion(h: Driven): Promise<void> {
  return h.debug.setCompletion(false);
}

/** Let the completion test fire again. */
export function allowCompletion(h: Driven): Promise<void> {
  return h.debug.setCompletion(true);
}

/* -------------------------------------------------------------------------- */
/* Running the machine the player's way                                       */
/* -------------------------------------------------------------------------- */
//
// The pair above poses a run through the surface; this pair drives it through the
// registered actions, which is what a check about the RUN CONTROLS reads. Both
// exist because they answer different questions: `startRun` skips the readiness
// condition on purpose ("the readiness condition the `play` action applies is not
// applied"), and `play` is the thing that applies it.

/** Press `play`: start the run, or toggle running and paused. */
export function playAction(h: Driven): Promise<OrrerySnapshot> {
  return pressAction(h, "play");
}

/** Press `step`: start the run paused at its settle, or run one whole cycle. */
export function stepAction(h: Driven): Promise<OrrerySnapshot> {
  return pressAction(h, "step");
}

/** Press `back`: stop a run, or leave the current screen. */
export function backAction(h: Driven): Promise<OrrerySnapshot> {
  return pressAction(h, "back");
}

/** Stop the run through the surface, returning the machine to the editor. */
export function stopRun(h: Driven): Promise<void> {
  return h.debug.stopRun();
}

/** Set the run's speed step, `0` to `3`. */
export function setSpeed(h: Driven, index: number): Promise<void> {
  return h.debug.setSpeed(index);
}

/* -------------------------------------------------------------------------- */
/* Reading a machine back                                                     */
/* -------------------------------------------------------------------------- */

/** The machine as a solution document, exactly what `loadSolution` would take. */
export function readMachine(h: Driven): Promise<Solution> {
  return h.debug.readSolution();
}

/** The build's own reference solution for a shipped challenge. */
export function referenceSolution(
  h: Driven,
  mode: "campaign" | "extras",
  index: number,
): Promise<Solution> {
  return h.debug.referenceSolution(mode, index);
}

/** The parts of a solution document, in placement order. */
export function partsOf(document: Solution): SolutionPart[] {
  return document.parts;
}

/**
 * The ids of the parts on the field, in placement order.
 *
 * The companion to {@link placePart} and its siblings, which answer the id of the
 * ONE part they placed. A check that posed its machine as a document — through
 * `openBareRun`'s `machine`, or `loadMachine` — placed several at once and has no
 * id for any of them, and `specs/instrumentation.md` fixes where they are:
 * `editor.parts` is in "placement order; the tape panel's row order". So
 * `partIds(h)` reads in the order the document listed them, which is also the
 * order `sim.fault.parts` is reported in.
 */
export async function partIds(h: Driven): Promise<number[]> {
  const snapshot = await h.snapshot();
  return snapshot.editor.parts.map((part) => part.id);
}

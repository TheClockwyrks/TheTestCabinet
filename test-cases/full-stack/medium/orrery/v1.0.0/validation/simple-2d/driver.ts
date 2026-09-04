// Orrery — the debug surface as a suite calls it. CASE-PROVIDED, and the SAME
// FILE in all three engine projects.
//
// THE SURFACE IS SPELLED THREE WAYS AND MEANS ONE THING. `specs/instrumentation.md`
// fixes one set of operations and then says how each engine's build exposes them:
//
//   - no engine  — installed on `window.__orrery`, called directly, and every
//                  call crosses into a page, so every call is a promise;
//   - simple-2d  — returned beside the state as `[state, debug]`, and written in
//                  the shape of `update`: a pose is `(state, ...args) => state`
//                  and a reading is `(state, ...args) => value`, driven through
//                  the engine's `apply` and `state`;
//   - structured-2d — returned from the instance's `initialize`, imperative: a
//                  pose takes only its own arguments and returns nothing, and a
//                  reading returns plain data.
//
// A CHECK MUST NOT KNOW WHICH. Orrery's rule is that the suite deciding one review
// item is the SAME TEXT under all three engines, so what a check holds is this
// DRIVER — one operation per row of `specs/instrumentation.md`, taking exactly the
// arguments that row names and answering a promise — and each project's
// `harness.ts` is what turns the build's own spelling into it. The promise is the
// price of that: an in-process call has nothing to wait for, but a suite that
// awaited under one engine and did not under another would be two suites.
//
// NOTHING HERE IS AN OPERATION THE SPECIFICATION DOES NOT CARRY. The compound
// sequences — opening a run, clearing the world, dragging a part — are the
// harness's, built out of these, exactly as
// `guides/authoring/writing-debug-apis-and-validators.md` requires.

import type {
  FocusName,
  InstructionName,
  MetricName,
  ModeName,
  MoteName,
  PartName,
  ScreenName,
} from "./constants";
import type { Challenge, Solution } from "./formats";
import type { MenuItemRect, OrrerySnapshot } from "./snapshot";

/**
 * Every operation of `specs/instrumentation.md`, as a check calls it.
 *
 * `version` is the one member that is not a call: the specification carries it as
 * "a plain number", so it is read rather than invoked, and it is reached off the
 * raw surface rather than through the driver — see each project's `surface.ts`.
 */
export interface OrreryDriver {
  /* -- Session ------------------------------------------------------------ */

  /** Restore every declared field of the state to its title-screen value. */
  reset(): Promise<void>;
  /** A pure read of the state. */
  snapshot(): Promise<OrrerySnapshot>;
  /** Set the completion switch. */
  setCompletion(enabled: boolean): Promise<void>;

  /* -- Navigation and progress -------------------------------------------- */

  /** Enter a screen, exactly as the real transition into it enters it. */
  setScreen(name: ScreenName): Promise<void>;
  /** Set the course the select and editor screens serve. */
  setMode(mode: ModeName): Promise<void>;
  /** Set the highlighted item of the menu the current screen shows. */
  setMenuIndex(n: number): Promise<void>;
  /** Set the highlighted row of the current mode's select screen. */
  setSelectIndex(n: number): Promise<void>;
  /** Set the how-to's current page, `0` to `HOWTO_PAGES - 1`. */
  setHowtoPage(n: number): Promise<void>;
  /** Set how many campaign challenges are open. */
  setUnlockedCount(n: number): Promise<void>;
  /** Add `index` to that mode's solved set, or remove it. */
  setSolved(mode: ModeName, index: number, solved: boolean): Promise<void>;
  /** Set one record of one challenge. */
  setRecord(
    mode: ModeName,
    index: number,
    metric: MetricName,
    value: number,
  ): Promise<void>;
  /** Set the row that mode's select screen lands on. */
  setLast(mode: ModeName, index: number): Promise<void>;

  /* -- The menu layout ---------------------------------------------------- */

  /**
   * The hit region of item `index` on the menu the current screen shows, in
   * logical units, or `null` where the screen shows no menu or `index` names no
   * item of it. A pure read.
   */
  menuItemRect(index: number): Promise<MenuItemRect | null>;

  /* -- The challenge ------------------------------------------------------ */

  /** Open that mode's shipped challenge at `index`, in the editor. */
  openChallenge(mode: ModeName, index: number): Promise<void>;
  /**
   * Open a challenge document directly. Typed `unknown` deliberately: a check
   * that asserts a malformed document is refused hands over something that is
   * NOT a `Challenge`, and the argument's type must not stand in the way.
   */
  loadChallenge(document: unknown): Promise<void>;
  /** The build's own reference solution for that challenge. A pure read. */
  referenceSolution(mode: ModeName, index: number): Promise<Solution>;

  /* -- The machine -------------------------------------------------------- */

  /** Remove every placed part, empty both histories, clear the hands. */
  clearMachine(): Promise<void>;
  /** Place one part of an arm, wheel, or sigil kind at a pose. */
  placePart(
    kind: PartName,
    q: number,
    r: number,
    rotation: number,
  ): Promise<void>;
  /** Place the rise for the open challenge's reagent `index`. */
  placeRise(
    index: number,
    q: number,
    r: number,
    rotation: number,
  ): Promise<void>;
  /** Place the set for the open challenge's product `index`. */
  placeSet(
    index: number,
    q: number,
    r: number,
    rotation: number,
  ): Promise<void>;
  /** Place a one-cell open track. */
  placeTrack(q: number, r: number): Promise<void>;
  /** Append a cell to that track's path at its `last` end. */
  extendTrack(part: number, q: number, r: number): Promise<void>;
  /** Join that track's last cell to its first. */
  closeTrack(part: number): Promise<void>;
  /** Remove one placed part. */
  removePart(part: number): Promise<void>;
  /** Set that part's REST rotation. */
  setPartRotation(part: number, rotation: number): Promise<void>;
  /** Set that part's REST length. */
  setPartLength(part: number, length: number): Promise<void>;
  /** Translate the whole part so its anchor is `(q, r)`. */
  movePart(part: number, q: number, r: number): Promise<void>;
  /** Write one instruction, or a blank, at column `col` of that part's tape. */
  setTapeCell(
    part: number,
    col: number,
    instruction: InstructionName | null,
  ): Promise<void>;
  /**
   * Replace the open challenge's machine with a solution document. Typed
   * `unknown` for the same reason {@link loadChallenge}'s argument is.
   */
  loadSolution(document: unknown): Promise<void>;
  /** The current machine as a solution document. A pure read. */
  readSolution(): Promise<Solution>;

  /* -- The editor's hands ------------------------------------------------- */

  /** Select that part. `null` clears the selection. */
  setSelected(part: number | null): Promise<void>;
  /** Set the focus to `"field"` or `"tape"`. */
  setFocus(where: FocusName): Promise<void>;
  /**
   * Point the tape cursor at column `col` of that part's row. A `part` of `null`
   * clears the cursor.
   *
   * `col` is REQUIRED, as the row `setCursor(part, col)` names it. "An argument
   * outside the domain its operation states is invalid, and the call fails
   * loudly" (`specs/instrumentation.md`), and `col` is "a whole number of at
   * least `0`", so a build is free to refuse an absent one — a check clearing the
   * cursor passes a column all the same.
   */
  setCursor(part: number | null, col: number): Promise<void>;
  /** Report a press at a logical stage position. Takes effect at the call. */
  pointerDown(x: number, y: number): Promise<void>;
  /** Report a move. Takes effect at the call. */
  pointerMove(x: number, y: number): Promise<void>;
  /** Report a release. Takes effect at the call. */
  pointerUp(): Promise<void>;

  /* -- The run ------------------------------------------------------------ */

  /** Run the game's run-start sequence, readiness condition not applied. */
  startRun(): Promise<void>;
  /** Return `sim` to `null` and the machine to the editor. */
  stopRun(): Promise<void>;
  /** Move `sim.status` between `running` and `paused`. */
  setPaused(paused: boolean): Promise<void>;
  /** Set `sim.speed` to a `SPEEDS` index, `0` to `3`. */
  setSpeed(index: number): Promise<void>;
  /** Set `sim.cycle`, so the next cycle executes tape cell `n mod P`. */
  setCycle(n: number): Promise<void>;
  /** Set the tally of the open challenge's product `index`. */
  setTally(index: number, n: number): Promise<void>;
  /** Remove every mote, fixtures included, and with them filaments and grips. */
  clearMotes(): Promise<void>;
  /** Add one unbonded, unheld mote of `type` resting on `(q, r)`. */
  spawnMote(q: number, r: number, type: MoteName): Promise<void>;
  /** Remove that mote and every filament and grip touching it. */
  removeMote(mote: number): Promise<void>;
  /** Join two motes with one filament of `weight` `1` or `3`. */
  linkMotes(a: number, b: number, weight: number): Promise<void>;
  /** Remove the filament joining two motes. */
  unlinkMotes(a: number, b: number): Promise<void>;
  /** That part's gripper on spoke `spoke` takes hold of `mote`'s constellation. */
  setGrip(part: number, spoke: number, mote: number): Promise<void>;
  /** That gripper opens, leaving what it held resting where it stands. */
  releaseGrip(part: number, spoke: number): Promise<void>;
  /** Set that part's LIVE rotation in `sim.poses`. */
  setPoseRotation(part: number, rotation: number): Promise<void>;
  /** Set that part's LIVE length. */
  setPoseLength(part: number, length: number): Promise<void>;
  /** Set that part's LIVE base cell, which is a cell of the track it is on. */
  setPoseCell(part: number, q: number, r: number): Promise<void>;

  /* -- The clock, under no engine alone ------------------------------------ */

  /**
   * Take the game off real time, and give it back. Present under NO ENGINE only:
   * `specs/instrumentation.md` carries the two clock operations there alone,
   * because under either engine the clock is the engine's.
   *
   * Optional so one suite text compiles in all three projects; each project's
   * harness answers the equivalent question of its own runtime, so a suite is
   * better served by `h.setAutoStep(...)` than by reaching for this.
   */
  setAutoStep?(enabled: boolean): Promise<void>;
  /**
   * Run `frames` whole frames covering `seconds` of game time. Present under NO
   * ENGINE only, for the same reason {@link setAutoStep} is; `h.advance` and the
   * harness's cycle helpers are what a portable suite drives the clock with.
   */
  advance?(seconds: number, frames?: number): Promise<void>;
}

/**
 * The names of the STATE operations, in the order `specs/instrumentation.md`
 * introduces them.
 *
 * The order matters: a build missing an operation is reported as missing it, and
 * the report reads best when it names them the way the specification does. The
 * two clock operations are NOT here — they exist under no engine alone, so each
 * project's `surface.ts` prepends them where they belong.
 */
export const STATE_OPS = [
  "reset",
  "snapshot",
  "setCompletion",
  "setScreen",
  "setMode",
  "setMenuIndex",
  "setSelectIndex",
  "setHowtoPage",
  "setUnlockedCount",
  "setSolved",
  "setRecord",
  "setLast",
  "menuItemRect",
  "openChallenge",
  "loadChallenge",
  "referenceSolution",
  "clearMachine",
  "placePart",
  "placeRise",
  "placeSet",
  "placeTrack",
  "extendTrack",
  "closeTrack",
  "removePart",
  "setPartRotation",
  "setPartLength",
  "movePart",
  "setTapeCell",
  "loadSolution",
  "readSolution",
  "setSelected",
  "setFocus",
  "setCursor",
  "pointerDown",
  "pointerMove",
  "pointerUp",
  "startRun",
  "stopRun",
  "setPaused",
  "setSpeed",
  "setCycle",
  "setTally",
  "clearMotes",
  "spawnMote",
  "removeMote",
  "linkMotes",
  "unlinkMotes",
  "setGrip",
  "releaseGrip",
  "setPoseRotation",
  "setPoseLength",
  "setPoseCell",
] as const;

/** The name of one operation of the surface. */
export type OperationName = (typeof STATE_OPS)[number];

/**
 * The four operations that READ rather than pose.
 *
 * Under `simple-2d` the distinction is load-bearing: a pose is run through the
 * engine's `apply` and a reading against `engine.state`, and driving one as the
 * other would either discard the answer or store it as the next state. Under the
 * other two engines the surface already tells them apart itself, and the list is
 * carried in all three so the three `surface.ts` files differ only where the
 * specification does.
 */
export const READINGS: readonly string[] = [
  "snapshot",
  "menuItemRect",
  "readSolution",
  "referenceSolution",
];

/** A challenge document, restated here so a suite imports one specifier. */
export type { Challenge, Solution };

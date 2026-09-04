// Orrery — the debug and automation surface (specs/instrumentation.md).
//
// Every operation here is a READ of the game's state or a POSE of one part of
// it. A pose sets ONE thing and leaves the rest of the game as it stands, and
// the game's own editor rules, simulation, sigils, and completion test run from
// there exactly as they do in play — so a caller that wants several things
// arranged makes several calls, in the order it wants them, and no pose decides
// an outcome.
//
// Two rules hold across the whole file. An argument outside the domain its
// operation states fails loudly, before anything is written, so a refused call
// changes nothing. And nothing here plays a cue: a pose changes the state alone
// and sounds nothing, the pointer operations included, so the cues a scenario
// hears come from the frames advanced after it.
//
// EVERY OPERATION IS WRITTEN IN THE SHAPE OF `update`, because the engine
// holds the state by value and nothing holds a writable one: a POSE takes the
// current state, as `DeepReadonly<OrreryState>`, and returns the next
// `OrreryState`, and a READING takes the state the same way and returns what
// it read. A caller drives a pose through the engine's `apply`, as
// `engine.apply((s) => debug.spawnMote(s, 0, 0, "dust"))`, and a reading
// directly, as `debug.snapshot(engine.state)`.
//
// `OrreryStateOps` below is the operation set written against a `Session`, one
// draft at a time, exactly as the frame writes it; `createDebugApi` is the
// adapter that turns each into a transition, by cloning the state it is
// handed, standing a session on the draft, running the one operation, and
// returning the draft. A refused call therefore changes nothing: the state the
// engine still holds was never touched.
//
// The clock is not here at all. The engine owns it — `engine.advance` over a
// clock of the caller's own — so this surface carries no operation for it, nor
// for the keyboard, the pointer bindings, or the overlay.

import { challengeCount, referenceSolutionFor } from "./challenges";
import { cloneState } from "./clone";
import {
  ARM_MAX_LEN,
  ARM_MIN_LEN,
  HOWTO_PAGES,
  ORRERY_DEBUG_VERSION,
  INSTRUCTIONS,
  MOTES,
  PARTS,
  SPEEDS,
  TITLE_ITEMS,
} from "./constants";
import { filamentBetween } from "./constellation";
import { parseChallenge, parseSolution, solutionFromMachine } from "./formats";
import { adjacent, sameHex } from "./hex";
import {
  addPart,
  clearMachine,
  closeTrack,
  extendTrack,
  loadMachine,
  machineFromSolution,
  movePart,
  removePart,
  requirePart,
  setPartLength,
  setPartRotation,
  setTapeCell,
} from "./machineops";
import { dropMote } from "./motes";
import { armSpokes, gripperHex, isArmKind, mountedTrack } from "./parts";
import { Session } from "./session";
import { startRun, stopRun } from "./sim";
import { snapshotOf } from "./snapshot";
import { clearSolved, markSolved, recordsOf, setLastOf } from "./state";
import type {
  Focus,
  Instruction,
  Mode,
  MoteState,
  MoteType,
  OrreryState,
  PartKind,
  Screen,
  SimState,
  Solution,
  W,
} from "./types";
import {
  invalid,
  requireBoolean,
  requireNumber,
  requireOneOf,
  requireRange,
  requireWhole,
} from "./validate";

/** The metric names `setRecord` writes. */
const METRICS = ["cost", "cycles", "area"] as const;
/** The screens `setScreen` enters. */
const SCREENS: readonly Screen[] = ["title", "howto", "select", "editor"];
/** The two courses. */
const MODES: readonly Mode[] = ["campaign", "extras"];
/** The two halves of the editor the focus routes keys to. */
const FOCUSES: readonly Focus[] = ["field", "tape"];

/** Every operation of the surface that reads or poses the game's state. */
export interface OrreryStateOps {
  reset(): void;
  snapshot(): Record<string, unknown>;
  setCompletion(enabled: boolean): void;

  setScreen(name: Screen): void;
  setMode(mode: Mode): void;
  setMenuIndex(n: number): void;
  setSelectIndex(n: number): void;
  setHowtoPage(n: number): void;
  setUnlockedCount(n: number): void;
  setSolved(mode: Mode, index: number, solved: boolean): void;
  setRecord(
    mode: Mode,
    index: number,
    metric: (typeof METRICS)[number],
    value: number,
  ): void;
  setLast(mode: Mode, index: number): void;

  openChallenge(mode: Mode, index: number): void;
  loadChallenge(challenge: unknown): void;
  referenceSolution(mode: Mode, index: number): Solution;

  clearMachine(): void;
  placePart(kind: PartKind, q: number, r: number, rotation: number): void;
  placeRise(index: number, q: number, r: number, rotation: number): void;
  placeSet(index: number, q: number, r: number, rotation: number): void;
  placeTrack(q: number, r: number): void;
  extendTrack(part: number, q: number, r: number): void;
  closeTrack(part: number): void;
  removePart(part: number): void;
  setPartRotation(part: number, rotation: number): void;
  setPartLength(part: number, length: number): void;
  movePart(part: number, q: number, r: number): void;
  setTapeCell(part: number, col: number, instruction: Instruction | null): void;
  loadSolution(solution: unknown): void;
  readSolution(): Solution;

  setSelected(part: number | null): void;
  setFocus(where: Focus): void;
  setCursor(part: number | null, col?: number): void;
  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;

  startRun(): void;
  stopRun(): void;
  setPaused(paused: boolean): void;
  setSpeed(index: number): void;
  setCycle(n: number): void;
  setTally(index: number, n: number): void;
  clearMotes(): void;
  spawnMote(q: number, r: number, type: MoteType): void;
  removeMote(mote: number): void;
  linkMotes(a: number, b: number, weight: number): void;
  unlinkMotes(a: number, b: number): void;
  setGrip(part: number, spoke: number, mote: number): void;
  releaseGrip(part: number, spoke: number): void;
  setPoseRotation(part: number, rotation: number): void;
  setPoseLength(part: number, length: number): void;
  setPoseCell(part: number, q: number, r: number): void;
}

/** Build every state operation over one session, working on its draft. */
export function createStateOps(session: Session): OrreryStateOps {
  const state = (): W<OrreryState> => session.state;

  /** The open challenge, or the refusal that none is. */
  const challengeOpen = (operation: string): void => {
    if (state().challenge === null) {
      throw new Error(`${operation}: no challenge is open`);
    }
  };

  /** The live run, or the refusal that none is. */
  const run = (operation: string): W<SimState> => {
    const sim = state().sim;
    if (sim === null) throw new Error(`${operation}: no run is live`);
    return sim;
  };

  /** A challenge index inside its mode's course, or the refusal naming the bounds. */
  const challengeIndex = (
    operation: string,
    mode: Mode,
    index: unknown,
  ): number => {
    const count = challengeCount(mode);
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count
    ) {
      throw new Error(
        `${operation}: index must be a whole number 0 to ${count - 1} for ${mode}; got ${String(index)}`,
      );
    }
    return index;
  };

  /** The mote `id` names, or the refusal that no mote carries it. */
  const mote = (
    operation: string,
    sim: W<SimState>,
    id: unknown,
  ): W<MoteState> => {
    if (typeof id !== "number" || !Number.isInteger(id)) {
      invalid(operation, "mote", "a mote id", id);
    }
    const found = sim.motes.find((entry) => entry.id === id);
    if (found === undefined) {
      throw new Error(`${operation}: no mote carries the id ${id}`);
    }
    return found;
  };

  /** How many items the menu the current screen shows holds. */
  const menuCount = (): number => {
    const current = state();
    if (current.screen === "title") return TITLE_ITEMS.length;
    if (current.screen === "editor" && current.sim?.status === "complete") {
      return session.solvedItems().length;
    }
    return 1;
  };

  return {
    // ----- Session -------------------------------------------------------
    reset() {
      session.reset();
    },

    snapshot() {
      return snapshotOf(state());
    },

    setCompletion(enabled) {
      state().completion = requireBoolean("setCompletion", "enabled", enabled);
    },

    // ----- Navigation and progress ---------------------------------------
    setScreen(name) {
      session.enterScreen(requireOneOf("setScreen", "name", name, SCREENS));
    },

    setMode(mode) {
      state().mode = requireOneOf("setMode", "mode", mode, MODES);
    },

    setMenuIndex(n) {
      state().menuIndex = requireRange(
        "setMenuIndex",
        "n",
        n,
        0,
        menuCount() - 1,
      );
    },

    setSelectIndex(n) {
      const count = challengeCount(state().mode);
      state().selectIndex = requireRange(
        "setSelectIndex",
        "n",
        n,
        0,
        Math.max(0, count - 1),
      );
    },

    setHowtoPage(n) {
      state().howtoPage = requireRange(
        "setHowtoPage",
        "n",
        n,
        0,
        HOWTO_PAGES - 1,
      );
    },

    setUnlockedCount(n) {
      const count = Math.max(1, challengeCount("campaign"));
      state().unlockedCount = requireRange(
        "setUnlockedCount",
        "n",
        n,
        1,
        count,
      );
    },

    setSolved(mode, index, solved) {
      const course = requireOneOf("setSolved", "mode", mode, MODES);
      const at = challengeIndex("setSolved", course, index);
      if (requireBoolean("setSolved", "solved", solved)) {
        markSolved(state(), course, at);
      } else {
        clearSolved(state(), course, at);
      }
    },

    setRecord(mode, index, metric, value) {
      const course = requireOneOf("setRecord", "mode", mode, MODES);
      const at = challengeIndex("setRecord", course, index);
      const name = requireOneOf("setRecord", "metric", metric, METRICS);
      const figure = requireWhole("setRecord", "value", value, 0);
      const records = recordsOf(state(), course);
      const standing = records[at] ?? { cost: 0, cycles: 0, area: 0 };
      records[at] = { ...standing, [name]: figure };
    },

    setLast(mode, index) {
      const course = requireOneOf("setLast", "mode", mode, MODES);
      setLastOf(state(), course, challengeIndex("setLast", course, index));
    },

    // ----- The challenge --------------------------------------------------
    openChallenge(mode, index) {
      const course = requireOneOf("openChallenge", "mode", mode, MODES);
      session.openChallenge(
        course,
        challengeIndex("openChallenge", course, index),
      );
    },

    loadChallenge(challenge) {
      session.loadChallenge(parseChallenge(challenge));
    },

    referenceSolution(mode, index) {
      const course = requireOneOf("referenceSolution", "mode", mode, MODES);
      return referenceSolutionFor(
        course,
        challengeIndex("referenceSolution", course, index),
      );
    },

    // ----- The machine ----------------------------------------------------
    clearMachine() {
      challengeOpen("clearMachine");
      clearMachine(state());
    },

    placePart(kind, q, r, rotation) {
      challengeOpen("placePart");
      const name = requireOneOf("placePart", "kind", kind, PARTS);
      if (name === "track" || name === "rise" || name === "set") {
        throw new Error(
          `placePart: a ${name} is placed with place${name === "track" ? "Track" : name === "rise" ? "Rise" : "Set"}`,
        );
      }
      addPart(
        state(),
        "placePart",
        name,
        requireWholeHex("placePart", "q", q),
        requireWholeHex("placePart", "r", r),
        requireRange("placePart", "rotation", rotation, 0, 5),
      );
    },

    placeRise(index, q, r, rotation) {
      challengeOpen("placeRise");
      const challenge = state().challenge;
      const at = requireRange(
        "placeRise",
        "index",
        index,
        0,
        (challenge?.reagents.length ?? 1) - 1,
      );
      addPart(
        state(),
        "placeRise",
        "rise",
        requireWholeHex("placeRise", "q", q),
        requireWholeHex("placeRise", "r", r),
        requireRange("placeRise", "rotation", rotation, 0, 5),
        { index: at },
      );
    },

    placeSet(index, q, r, rotation) {
      challengeOpen("placeSet");
      const challenge = state().challenge;
      const at = requireRange(
        "placeSet",
        "index",
        index,
        0,
        (challenge?.products.length ?? 1) - 1,
      );
      addPart(
        state(),
        "placeSet",
        "set",
        requireWholeHex("placeSet", "q", q),
        requireWholeHex("placeSet", "r", r),
        requireRange("placeSet", "rotation", rotation, 0, 5),
        { index: at },
      );
    },

    placeTrack(q, r) {
      challengeOpen("placeTrack");
      addPart(
        state(),
        "placeTrack",
        "track",
        requireWholeHex("placeTrack", "q", q),
        requireWholeHex("placeTrack", "r", r),
        0,
      );
    },

    extendTrack(part, q, r) {
      challengeOpen("extendTrack");
      extendTrack(
        state(),
        "extendTrack",
        requirePart(state(), "extendTrack", part),
        requireWholeHex("extendTrack", "q", q),
        requireWholeHex("extendTrack", "r", r),
      );
    },

    closeTrack(part) {
      challengeOpen("closeTrack");
      closeTrack(
        state(),
        "closeTrack",
        requirePart(state(), "closeTrack", part),
      );
    },

    removePart(part) {
      challengeOpen("removePart");
      removePart(state(), requirePart(state(), "removePart", part));
    },

    setPartRotation(part, rotation) {
      challengeOpen("setPartRotation");
      setPartRotation(
        state(),
        "setPartRotation",
        requirePart(state(), "setPartRotation", part),
        requireRange("setPartRotation", "rotation", rotation, 0, 5),
      );
    },

    setPartLength(part, length) {
      challengeOpen("setPartLength");
      setPartLength(
        state(),
        "setPartLength",
        requirePart(state(), "setPartLength", part),
        requireRange(
          "setPartLength",
          "length",
          length,
          ARM_MIN_LEN,
          ARM_MAX_LEN,
        ),
      );
    },

    movePart(part, q, r) {
      challengeOpen("movePart");
      movePart(
        state(),
        "movePart",
        requirePart(state(), "movePart", part),
        requireWholeHex("movePart", "q", q),
        requireWholeHex("movePart", "r", r),
      );
    },

    setTapeCell(part, col, instruction) {
      challengeOpen("setTapeCell");
      const written =
        instruction === null
          ? null
          : requireOneOf(
              "setTapeCell",
              "instruction",
              instruction,
              INSTRUCTIONS,
            );
      setTapeCell(
        state(),
        "setTapeCell",
        requirePart(state(), "setTapeCell", part),
        requireWhole("setTapeCell", "col", col, 0),
        written,
      );
    },

    loadSolution(solution) {
      challengeOpen("loadSolution");
      const document = parseSolution(solution);
      const current = state();
      // The whole document is built and checked before anything is written, so
      // a solution one part of which is illegal changes nothing at all.
      loadMachine(
        current,
        machineFromSolution(
          "loadSolution",
          document.parts,
          current.challenge,
          current.editor.nextId,
        ),
      );
    },

    readSolution() {
      challengeOpen("readSolution");
      return solutionFromMachine(state().editor.parts);
    },

    // ----- The editor's hands ---------------------------------------------
    setSelected(part) {
      if (part === null) {
        state().editor.selected = null;
        return;
      }
      state().editor.selected = requirePart(state(), "setSelected", part).id;
    },

    setFocus(where) {
      state().editor.focus = requireOneOf("setFocus", "where", where, FOCUSES);
    },

    setCursor(part, col = 0) {
      if (part === null) {
        state().editor.cursor = null;
        return;
      }
      const target = requirePart(state(), "setCursor", part);
      if (target.tape === null) {
        throw new Error(`setCursor: a ${target.kind} carries no tape row`);
      }
      state().editor.cursor = {
        part: target.id,
        col: requireWhole("setCursor", "col", col, 0),
      };
    },

    pointerDown(x, y) {
      session.handlePointer({
        type: "down",
        x: requireNumber("pointerDown", "x", x),
        y: requireNumber("pointerDown", "y", y),
      });
    },

    pointerMove(x, y) {
      session.handlePointer({
        type: "move",
        x: requireNumber("pointerMove", "x", x),
        y: requireNumber("pointerMove", "y", y),
      });
    },

    pointerUp() {
      const at = state().pointer;
      session.handlePointer({ type: "up", x: at.x, y: at.y });
    },

    // ----- The run ---------------------------------------------------------
    startRun() {
      challengeOpen("startRun");
      startRun(session);
    },

    stopRun() {
      run("stopRun");
      stopRun(state());
    },

    setPaused(paused) {
      const sim = run("setPaused");
      const wanted = requireBoolean("setPaused", "paused", paused);
      if (sim.status === "faulted" || sim.status === "complete") {
        throw new Error(`setPaused: the run is ${sim.status}`);
      }
      sim.status = wanted ? "paused" : "running";
    },

    setSpeed(index) {
      run("setSpeed").speed = requireRange(
        "setSpeed",
        "index",
        index,
        0,
        SPEEDS.length - 1,
      );
    },

    setCycle(n) {
      const sim = run("setCycle");
      sim.cycle = requireWhole("setCycle", "n", n, 0);
      sim.pending = null;
    },

    setTally(index, n) {
      const sim = run("setTally");
      const products = state().challenge?.products.length ?? 0;
      const at = requireRange("setTally", "index", index, 0, products - 1);
      sim.tallies[at] = requireWhole("setTally", "n", n, 0);
    },

    clearMotes() {
      const sim = run("clearMotes");
      sim.motes = [];
      sim.filaments = [];
      sim.grips = [];
    },

    spawnMote(q, r, type) {
      const sim = run("spawnMote");
      const cell = {
        q: requireWholeHex("spawnMote", "q", q),
        r: requireWholeHex("spawnMote", "r", r),
      };
      const name = requireOneOf("spawnMote", "type", type, MOTES);
      if (sim.motes.some((entry) => sameHex(entry, cell))) {
        throw new Error(
          `spawnMote: (${cell.q}, ${cell.r}) already holds a mote`,
        );
      }
      sim.motes.push({
        id: sim.nextMoteId,
        q: cell.q,
        r: cell.r,
        type: name,
        wheel: null,
      });
      sim.nextMoteId += 1;
    },

    removeMote(id) {
      const sim = run("removeMote");
      dropMote(sim, mote("removeMote", sim, id).id);
    },

    linkMotes(a, b, weight) {
      const sim = run("linkMotes");
      const first = mote("linkMotes", sim, a);
      const second = mote("linkMotes", sim, b);
      if (weight !== 1 && weight !== 3) {
        invalid("linkMotes", "weight", "1 or 3", weight);
      }
      if (first.wheel !== null || second.wheel !== null) {
        throw new Error("linkMotes: a fixture carries no filament");
      }
      if (!adjacent(first, second)) {
        throw new Error("linkMotes: the two motes are not on adjacent hexes");
      }
      if (filamentBetween(sim, first.id, second.id) !== null) {
        throw new Error("linkMotes: a filament already joins that pair");
      }
      sim.filaments.push({ a: first.id, b: second.id, weight });
    },

    unlinkMotes(a, b) {
      const sim = run("unlinkMotes");
      const first = mote("unlinkMotes", sim, a);
      const second = mote("unlinkMotes", sim, b);
      const filament = filamentBetween(sim, first.id, second.id);
      if (filament === null) {
        throw new Error("unlinkMotes: no filament joins that pair");
      }
      sim.filaments = sim.filaments.filter((entry) => entry !== filament);
    },

    setGrip(part, spoke, moteId) {
      const sim = run("setGrip");
      const placed = requirePart(state(), "setGrip", part);
      const pose = sim.poses.find((entry) => entry.part === placed.id);
      const direction = requireRange("setGrip", "spoke", spoke, 0, 5);
      if (pose === undefined || !isArmKind(placed.kind)) {
        throw new Error(`setGrip: a ${placed.kind} carries no gripper`);
      }
      if (!armSpokes(placed.kind, pose.rotation).includes(direction)) {
        throw new Error(
          `setGrip: this ${placed.kind} carries no gripper on spoke ${direction}`,
        );
      }
      const held = mote("setGrip", sim, moteId);
      if (held.wheel !== null) {
        throw new Error("setGrip: a fixture is never carried by an arm");
      }
      const at = gripperHex(pose.cell, direction, pose.length);
      if (!sameHex(held, at)) {
        throw new Error(
          `setGrip: mote ${held.id} does not rest on that gripper's hex`,
        );
      }
      sim.grips = sim.grips.filter(
        (grip) => grip.part !== placed.id || grip.spoke !== direction,
      );
      sim.grips.push({ part: placed.id, spoke: direction, mote: held.id });
    },

    releaseGrip(part, spoke) {
      const sim = run("releaseGrip");
      const placed = requirePart(state(), "releaseGrip", part);
      const direction = requireRange("releaseGrip", "spoke", spoke, 0, 5);
      sim.grips = sim.grips.filter(
        (grip) => grip.part !== placed.id || grip.spoke !== direction,
      );
    },

    setPoseRotation(part, rotation) {
      const sim = run("setPoseRotation");
      pose(
        sim,
        "setPoseRotation",
        requirePart(state(), "setPoseRotation", part).id,
      ).rotation = requireRange("setPoseRotation", "rotation", rotation, 0, 5);
    },

    setPoseLength(part, length) {
      const sim = run("setPoseLength");
      pose(
        sim,
        "setPoseLength",
        requirePart(state(), "setPoseLength", part).id,
      ).length = requireRange(
        "setPoseLength",
        "length",
        length,
        ARM_MIN_LEN,
        ARM_MAX_LEN,
      );
    },

    setPoseCell(part, q, r) {
      const sim = run("setPoseCell");
      const placed = requirePart(state(), "setPoseCell", part);
      const cell = {
        q: requireWholeHex("setPoseCell", "q", q),
        r: requireWholeHex("setPoseCell", "r", r),
      };
      const track = mountedTrack(
        { q: placed.q, r: placed.r },
        state().editor.parts,
      );
      if (track === null) {
        throw new Error("setPoseCell: that part is not mounted on a track");
      }
      if (!(track.cells ?? []).some((entry) => sameHex(entry, cell))) {
        throw new Error(
          `setPoseCell: (${cell.q}, ${cell.r}) is not a cell of that track`,
        );
      }
      pose(sim, "setPoseCell", placed.id).cell = cell;
    },
  };
}

/** A whole-number hex coordinate, or the surface's refusal. */
function requireWholeHex(
  operation: string,
  argument: string,
  value: unknown,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    invalid(operation, argument, "a whole number", value);
  }
  return value;
}

/** A part's live pose, or the surface's refusal that it carries none. */
function pose(
  sim: W<SimState>,
  operation: string,
  part: number,
): W<SimState>["poses"][number] {
  const found = sim.poses.find((entry) => entry.part === part);
  if (found === undefined) {
    throw new Error(`${operation}: part ${part} carries no live pose`);
  }
  return found;
}

/**
 * A pose, in the shape `update` has: the current state in, the next out.
 *
 * The arguments a row of `specs/instrumentation.md` names follow the state, so
 * `setSpeed(index)` is called as `debug.setSpeed(state, index)`.
 */
type Pose<F> = F extends (...args: infer A) => void
  ? (state: OrreryState, ...args: A) => OrreryState
  : never;

/** A reading: the current state in, what it read out, and nothing changed. */
type Reading<F> = F extends (...args: infer A) => infer R
  ? (state: OrreryState, ...args: A) => R
  : never;

/** The three operations that read rather than pose. */
type ReadingName = "snapshot" | "readSolution" | "referenceSolution";

/**
 * The surface `initialize` returns beside the state, and `engine.debug` hands
 * back unchanged. Derived from `OrreryStateOps` so the two can never drift:
 * every operation there is a pose here unless it is one of the three readings.
 */
export type OrreryDebugApi = {
  /** `ORRERY_DEBUG_VERSION` (`1`), a plain number. */
  readonly version: number;
} & {
  [K in Exclude<keyof OrreryStateOps, ReadingName>]: Pose<OrreryStateOps[K]>;
} & {
  [K in ReadingName]: Reading<OrreryStateOps[K]>;
};

/**
 * Run one operation over a draft taken from `state`, and return the draft as
 * the next state. The clone is what makes a refused call a no-op: the
 * operation validates and throws before anything but the copy is written.
 */
function transition<A extends unknown[]>(
  operation: (ops: OrreryStateOps) => (...args: A) => void,
): (state: OrreryState, ...args: A) => OrreryState {
  return (state, ...args): OrreryState => {
    const session = new Session(cloneState(state));
    operation(createStateOps(session))(...args);
    return session.state;
  };
}

/** Run one reading over a draft taken from `state`, changing nothing. */
function reading<A extends unknown[], R>(
  operation: (ops: OrreryStateOps) => (...args: A) => R,
): (state: OrreryState, ...args: A) => R {
  return (state, ...args): R =>
    operation(createStateOps(new Session(cloneState(state))))(...args);
}

/** The finished surface, built once and returned from `initialize`. */
export function createDebugApi(): OrreryDebugApi {
  return {
    version: ORRERY_DEBUG_VERSION,

    // Session
    reset: transition((ops) => ops.reset),
    snapshot: (state) => snapshotOf(state),
    setCompletion: transition((ops) => ops.setCompletion),

    // Navigation and progress
    setScreen: transition((ops) => ops.setScreen),
    setMode: transition((ops) => ops.setMode),
    setMenuIndex: transition((ops) => ops.setMenuIndex),
    setSelectIndex: transition((ops) => ops.setSelectIndex),
    setHowtoPage: transition((ops) => ops.setHowtoPage),
    setUnlockedCount: transition((ops) => ops.setUnlockedCount),
    setSolved: transition((ops) => ops.setSolved),
    setRecord: transition((ops) => ops.setRecord),
    setLast: transition((ops) => ops.setLast),

    // The challenge
    openChallenge: transition((ops) => ops.openChallenge),
    loadChallenge: transition((ops) => ops.loadChallenge),
    referenceSolution: reading((ops) => ops.referenceSolution),

    // The machine
    clearMachine: transition((ops) => ops.clearMachine),
    placePart: transition((ops) => ops.placePart),
    placeRise: transition((ops) => ops.placeRise),
    placeSet: transition((ops) => ops.placeSet),
    placeTrack: transition((ops) => ops.placeTrack),
    extendTrack: transition((ops) => ops.extendTrack),
    closeTrack: transition((ops) => ops.closeTrack),
    removePart: transition((ops) => ops.removePart),
    setPartRotation: transition((ops) => ops.setPartRotation),
    setPartLength: transition((ops) => ops.setPartLength),
    movePart: transition((ops) => ops.movePart),
    setTapeCell: transition((ops) => ops.setTapeCell),
    loadSolution: transition((ops) => ops.loadSolution),
    readSolution: reading((ops) => ops.readSolution),

    // The editor's hands
    setSelected: transition((ops) => ops.setSelected),
    setFocus: transition((ops) => ops.setFocus),
    setCursor: transition((ops) => ops.setCursor),
    pointerDown: transition((ops) => ops.pointerDown),
    pointerMove: transition((ops) => ops.pointerMove),
    pointerUp: transition((ops) => ops.pointerUp),

    // The run
    startRun: transition((ops) => ops.startRun),
    stopRun: transition((ops) => ops.stopRun),
    setPaused: transition((ops) => ops.setPaused),
    setSpeed: transition((ops) => ops.setSpeed),
    setCycle: transition((ops) => ops.setCycle),
    setTally: transition((ops) => ops.setTally),
    clearMotes: transition((ops) => ops.clearMotes),
    spawnMote: transition((ops) => ops.spawnMote),
    removeMote: transition((ops) => ops.removeMote),
    linkMotes: transition((ops) => ops.linkMotes),
    unlinkMotes: transition((ops) => ops.unlinkMotes),
    setGrip: transition((ops) => ops.setGrip),
    releaseGrip: transition((ops) => ops.releaseGrip),
    setPoseRotation: transition((ops) => ops.setPoseRotation),
    setPoseLength: transition((ops) => ops.setPoseLength),
    setPoseCell: transition((ops) => ops.setPoseCell),
  };
}

// Gantry — the debug surface and the snapshot, AS THE SPECIFICATION STATES THEM.
// CASE-PROVIDED.
//
// THIS FILE IS THE CASE'S DESCRIPTION OF THE CONTRACT, AND THE ONLY ONE THE
// HARNESS READS. Every declaration below is transcribed from
// `specs/instrumentation.md` (the `structured-3d` branch) and `specs/state.md`,
// and from nothing else. It deliberately does NOT import the build's own
// `src/game.ts`: a build that declared its types differently, or did not declare
// them at all, must FAIL ITS ITEMS rather than fail to compile this harness.
// Typing the harness off the build would make an unbuildable build
// indistinguishable from a missing test run, and the whole point of a validator
// is that it always reaches a verdict. The harness reaches the build's value —
// the `GameDefinition` its `src/game.ts` exports — and casts it to the shape
// below, so what the build owes is checked where a check reaches for it.
//
// NOTHING HERE IS ASYNC, AND THAT IS THE ONE PLACE THIS FILE DIFFERS FROM ITS
// TWIN IN `validation/none/`. Under this engine the surface is an ordinary object
// the game instance's `initialize` returned, held by the engine and handed back
// from `engine.debug`, and each operation acts on the live world at the moment of
// the call: a pose returns nothing and a reading returns what it read, both
// synchronously. The ASYNC surface a validator drives is {@link GantryDriver}
// below — the same operations, each wrapped in a promise by `harness.ts` — which
// is what lets one `<category>/<id>.test.ts` file sit unchanged in all three
// engine directories.
//
// FOUR GROUPS OF OPERATIONS ARE ABSENT HERE AND PRESENT UNDER `none`, and the
// specification is what removes them: "The clock, the keyboard, the pointer, the
// camera's projection, and the overlay belong to the Structured 3D engine ... and
// the surface carries no operation for any of them." So there is no
// `setAutoStep`, no `advance`, no `project`, and no `pointerMove`/`pointerDown`/
// `pointerUp`/`keyDown`/`keyUp`. A validator still reaches all of them, as
// `h.advance`, `h.project`, `h.keyDown`… on the harness, which drives the engine
// for them — and never learns that they were the surface's job under `none`.
//
// THE PARAMETERS ARE SCALARS. `specs/instrumentation.md` fixes that: "Every
// argument is a plain number, string, or boolean: a world position is passed as
// its three coordinates in order, an angle is in degrees, and an `id` is a
// member's identifier as `snapshot` reports it." So `setBob(x, y, z)` and never
// `setBob(pos)` — a build is free to hold a position however it likes, and an
// operation taking an object would make this case's layout a requirement on it.

/* -------------------------------------------------------------------------- */
/* The vocabularies                                                           */
/* -------------------------------------------------------------------------- */

/** A position on the world frame, in units (`specs/world.md`). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A load pose: its lift point, and its yaw in degrees (`specs/world.md`). */
export interface LoadPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** The three load classes, whose dimensions `specs/world.md` fixes. */
export type LoadClass = "crate" | "container" | "drum";

/** The three materials `specs/structure.md` gives. */
export type MaterialName = "strut" | "cable" | "rail";

/** The six build tools `specs/controls.md` gives. */
export type Tool =
  "strut" | "cable" | "rail" | "ring" | "counterweight" | "delete";

/** The seven screens `specs/ui.md` gives. */
export type Screen =
  "title" | "howto" | "select" | "build" | "program" | "run" | "results";

/** The four axes `specs/program.md` gives. */
export type AxisName = "slew" | "trolley" | "hoist" | "grip";

/** The two action steps a tape can carry (`specs/program.md`). */
export type TapeAction = "attach" | "release";

/** A structure's readiness issue (`specs/structure.md`). */
export type ReadinessIssue =
  "no-ring" | "no-rail" | "invalid-rail" | "disconnected-members";

/** What would refuse a run: a readiness issue, or an empty tape. */
export type StartIssue = ReadinessIssue | "empty-program";

/** Where a load stands during a run (`specs/state.md`). */
export type LoadPhase = "waiting" | "attached" | "placed" | "lost";

/** Where a run stands (`specs/state.md`). */
export type RunPhase = "idle" | "running" | "cleared" | "failed";

/** The closed vocabulary of failures `specs/statics.md` collects. */
export type FailCause =
  | "collapse"
  | "ring-overload"
  | "cable-snap"
  | "structure-struck-obstacle"
  | "load-struck-obstacle"
  | "load-struck-ground"
  | "attach-missed"
  | "release-misplaced"
  | "command-out-of-range"
  | "loads-unplaced";

/* -------------------------------------------------------------------------- */
/* The shapes a reading answers with                                          */
/* -------------------------------------------------------------------------- */

/** One member's solved force and utilization (`specs/statics.md`). */
export interface MemberForce {
  id: number;
  force: number;
  utilization: number;
}

/** What the static check of `specs/structure.md` reports. */
export interface CheckResult {
  /** Empty when nothing would refuse a run; in the order `check` reports them. */
  issues: StartIssue[];
  cost: number;
  budget: number;
  /** Whether the structure stands. */
  stable: boolean;
  /** In member-id order; empty exactly when the structure does not stand. */
  members: MemberForce[];
}

/**
 * Where a world position is drawn, in logical stage units.
 *
 * `visible` is whether the position lies in front of the camera and inside the
 * stage (`specs/instrumentation.md`).
 */
export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

/** One obstacle: the axis-aligned box it fills. */
export interface Obstacle {
  min: Vec3;
  size: Vec3;
}

/** One load a site asks for: where it stands, and where it is wanted. */
export interface SiteLoad {
  class: LoadClass;
  mass: number;
  /** The lift point it starts at, and its yaw. */
  from: LoadPose;
  /** The pad it is wanted on. */
  to: LoadPose;
}

/** A cleared site's recorded score. */
export interface Score {
  cost: number;
  time: number;
}

/** One member, as a snapshot reports it. */
export interface MemberView {
  id: number;
  a: Vec3;
  b: Vec3;
  material: MaterialName;
}

/** One tape step, as a snapshot reports it. */
export type StepView =
  | {
      kind: "move";
      commands: { axis: AxisName; target: number; rate: number }[];
    }
  | { kind: "action"; action: TapeAction };

/** One axis during a run; `command` is null when none is live on it. */
export interface AxisView {
  value: number;
  rate: number;
  command: { target: number; rate: number } | null;
}

/** One load during a run: one entry per load the run started with. */
export interface RunLoadView {
  phase: LoadPhase;
  pos: Vec3;
  yaw: number;
}

/** The run in progress, the run last ended, or the idle placeholder. */
export interface RunView {
  phase: RunPhase;
  cause: FailCause | null;
  tick: number;
  /** `tick / TICK_HZ`, seconds. */
  time: number;
  /** Into `RUN_SPEEDS`. */
  speedIndex: number;
  stepIndex: number;
  /** That step is taken and not yet complete. */
  stepLive: boolean;
  axes: Record<AxisName, AxisView>;
  /** The point the cable hangs from, at the most recent tick's geometry. */
  pivot: Vec3;
  bob: { pos: Vec3; vel: Vec3 };
  /** The attached load's index, or null. */
  attached: number | null;
  loads: RunLoadView[];
  /** The latest solve's, in member-id order, over the members still intact. */
  forces: MemberForce[];
  /** Member ids, in the order they broke. */
  broken: number[];
}

/** The open site, as it currently stands. */
export interface SiteView {
  name: string;
  envelope: { min: Vec3; max: Vec3 };
  anchors: Vec3[];
  budget: number;
  par: { cost: number; time: number };
  loads: SiteLoad[];
  obstacles: Obstacle[];
}

/** The structure being built, as a snapshot reports it. */
export interface StructureView {
  members: MemberView[];
  /** The id the next member takes. */
  nextMemberId: number;
  ring: { corner: Vec3 } | null;
  counterweights: Vec3[];
  cost: number;
  /** The readiness issues, empty when ready. */
  issues: StartIssue[];
}

/** The pointer's six fields (`specs/instrumentation.md`). */
export interface PointerView {
  /** Logical stage units. */
  x: number;
  y: number;
  /** A press is live. */
  down: boolean;
  /** Where the live press went down, in the same units. */
  pressX: number;
  pressY: number;
  /** The press has reached `CLICK_SLOP`. */
  dragging: boolean;
}

/** What a click at the pointer would take. */
export interface PickView {
  node: Vec3 | null;
  member: number | null;
}

/**
 * The plain object `snapshot()` returns.
 *
 * Transcribed from the Snapshot shape block of `specs/instrumentation.md`. The
 * shape is fixed and every field is present whatever the screen, so nothing here
 * is optional: a build that omits a field fails the item that reads it, which is
 * the verdict the specification asks for.
 */
export interface GantrySnapshot {
  version: number;
  screen: Screen;
  /** The highlighted menu entry, from 0. */
  menuIndex: number;
  /** The open, or last open, site, from 0. */
  siteIndex: number;
  /** One per site. */
  cleared: boolean[];
  /** One per site. */
  best: (Score | null)[];
  site: SiteView;
  tool: Tool;
  pendingNode: Vec3 | null;
  /** Edits the open site can still undo. */
  historyDepth: number;
  camera: { yaw: number; pitch: number; dist: number };
  pointer: PointerView;
  pick: PickView;
  structure: StructureView;
  program: StepView[];
  /** What the build screen is showing, or null. */
  checkResult: CheckResult | null;
  run: RunView;
  muted: boolean;
  simTime: number;
}

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every operation `specs/instrumentation.md` requires of the surface under this
 * engine, in the order that file introduces them.
 *
 * This is what the BUILD implements and what its game instance's `initialize`
 * returns; the engine holds it and hands it back from `engine.debug`, and that is
 * the only route to it — "nothing is installed on the page". Each operation takes
 * only the parameters its table names, acts on the live world the moment it is
 * called, and answers synchronously: "A pose returns nothing; a reading returns
 * what it read and changes nothing."
 *
 * The surface also carries `version` (`GANTRY_DEBUG_VERSION`, `1`), a plain
 * number. It is deliberately NOT declared here: it is a data field rather than an
 * operation, and {@link GantryDriver} below is a mapping over the operations. The
 * harness reads it off the raw surface instead, and the one item that is about it
 * asserts on that reading.
 */
export interface GantryDebugApi {
  /* ---- Readings ----------------------------------------------------------- */

  snapshot(): GantrySnapshot;
  /** The static check of `specs/structure.md`, computed on the spot. */
  check(): CheckResult;

  /* ---- The run and the screens ------------------------------------------- */

  /** Returns the game to its title state, `muted` aside. */
  reset(): void;
  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  /** Opens site `index`, locked or not, and shows the `build` screen. */
  openSite(index: number): void;
  setCleared(index: number, cleared: boolean): void;
  setBest(index: number, cost: number, time: number): void;
  clearBest(index: number): void;
  setCamera(yaw: number, pitch: number, dist: number): void;
  /** Poses the `run` action: the same refusals, the same `run-start`. */
  startRun(): void;
  /** Poses the abort: a running run ends with no verdict. */
  abortRun(): void;

  /* ---- The structure ------------------------------------------------------ */

  clearStructure(): void;
  addMember(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    material: MaterialName,
  ): void;
  removeMember(id: number): void;
  /** Places the slew ring by its base corner at that lattice node. */
  setRing(x: number, y: number, z: number): void;
  clearRing(): void;
  addCounterweight(x: number, y: number, z: number): void;
  removeCounterweight(x: number, y: number, z: number): void;
  setTool(tool: Tool): void;
  setPendingNode(x: number, y: number, z: number): void;
  clearPendingNode(): void;

  /* ---- The tape ----------------------------------------------------------- */

  clearProgram(): void;
  /** Appends a move step carrying one command. */
  addMoveStep(axis: AxisName, target: number, rate: number): void;
  /** Adds a command to the move step at `index`. */
  addCommand(index: number, axis: AxisName, target: number, rate: number): void;
  addActionStep(action: TapeAction): void;
  removeStep(index: number): void;

  /* ---- The site ----------------------------------------------------------- */

  clearLoads(): void;
  addLoad(
    cls: LoadClass,
    mass: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void;
  setLoadTarget(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void;
  clearObstacles(): void;
  addObstacle(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ): void;

  /* ---- The run in progress ------------------------------------------------ */

  setAxis(axis: AxisName, value: number): void;
  setAxisRate(axis: AxisName, rate: number): void;
  setBob(x: number, y: number, z: number): void;
  setBobVelocity(vx: number, vy: number, vz: number): void;
  setLoadPose(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void;
  setLoadPhase(index: number, phase: LoadPhase): void;
  /** Sets the watch speed to that index into `RUN_SPEEDS`. */
  setSpeedIndex(index: number): void;
}

/**
 * The operations a validator reaches through `h.debug`.
 *
 * THE SAME NAMES AND THE SAME PARAMETERS AS {@link GantryDebugApi}, EACH ASYNC.
 * The surface a build returns is synchronous, because the world is live and an
 * operation acts on it at the call; a validator is written against a harness
 * whose every member is `async`, because the engineless project's genuinely is —
 * each of its calls crosses into Chromium — and one suite grading three runtimes
 * is worth more than a promise nobody waits on. `harness.ts` is where the
 * wrapping happens, so a build implements the surface exactly as
 * `specs/instrumentation.md` states it and never learns that a validator awaits.
 *
 * Nothing is dropped here, unlike the engineless project's `GantryDriver`. There
 * the clock, the projection and the five input operations are ON the surface and
 * the harness lifts them OUT of `debug` onto itself; here the specification never
 * put them on the surface at all, so the driver is the whole of it. `snapshot` and
 * `check` stay in both, for the same reason in both: they are lifted onto the
 * harness for convenience (`h.snapshot()`), not lifted out of the surface.
 */
export type GantryDriver = {
  [K in keyof GantryDebugApi]: GantryDebugApi[K] extends (
    ...args: infer A
  ) => infer R
    ? (...args: A) => Promise<R>
    : never;
};

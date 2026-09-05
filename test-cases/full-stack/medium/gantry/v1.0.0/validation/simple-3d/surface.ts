// Gantry — the debug surface and the snapshot, AS THE SPECIFICATION STATES THEM,
// for a build on the SIMPLE 3D engine. CASE-PROVIDED.
//
// THIS FILE IS THE CASE'S DESCRIPTION OF THE CONTRACT, AND THE ONLY ONE THE
// HARNESS READS. Every declaration below is transcribed from
// `specs/instrumentation.md` (the `simple-3d` branch) and `specs/state.md`, and
// from nothing else. It deliberately does NOT import the build's own
// `src/game.ts`: a build that declared `GantryDebugApi` differently, or did not
// declare it at all, must FAIL ITS ITEMS rather than fail to compile this
// harness. Typing the harness off the build would make an unbuildable build
// indistinguishable from a missing test run, and the whole point of a validator
// is that it always reaches a verdict.
//
// TWO SHAPES, AND THE DIFFERENCE BETWEEN THEM IS THE ENGINE. Under this engine
// the state is a VALUE the engine holds and hands out read-only, so
// `specs/instrumentation.md` writes every operation in the shape of `update`:
// "Each operation's first parameter is the current state,
// `DeepReadonly<GantryState>`, before the parameters its table names… A pose
// returns the next `GantryState`, built from the one it was handed, which it
// leaves as it was; a reading returns what it read."
//
//   - {@link GantryDebugApi} is that surface, exactly: state first, synchronous,
//     a pose answering the next state. It is what the BUILD implements and what
//     `engine.debug` hands back.
//   - {@link GantryDriver} is what a VALIDATOR holds: the same operations with
//     the state argument gone and every one of them `async`. The harness runs
//     each pose through `engine.apply` and hands each reading `engine.state`, so
//     a check writes `await h.debug.setTool("cable")` and never holds a writable
//     state.
//
// `GantryDriver` is derived from `GantryDebugApi` rather than written out, which
// is what keeps it identical — member for member, parameter for parameter — to
// the `GantryDriver` `validation/none/surface.ts` declares. That identity is the
// whole reason one `<category>/<id>.test.ts` file sits unchanged in all three
// engines' directories.
//
// THE PARAMETERS ARE SCALARS. `specs/instrumentation.md` fixes that: "Every
// argument is a plain number, string, or boolean: a world position is passed as
// its three coordinates in order, an angle is in degrees, and an `id` is a
// member's identifier as `snapshot` reports it." So `setBob(state, x, y, z)` and
// never `setBob(state, pos)` — a build is free to hold a position however it
// likes, and an operation taking an object would make this case's layout a
// requirement on it.

import type { DeepReadonly } from "@clockwyrks/simple-3d";

/* -------------------------------------------------------------------------- */
/* The state, as far as a validator is concerned                              */
/* -------------------------------------------------------------------------- */

/**
 * The build's own `GantryState`, held OPAQUE.
 *
 * `specs/state.md` fixes the state's shape and the build declares it, but this
 * harness never reads a field of one: everything a check learns about the game
 * comes through `snapshot`, which is a plain object the specification pins down
 * in full. So the state travels through here as a value with no readable
 * structure — the engine hands it to a pose, the pose hands the next one back,
 * and nothing in between looks inside.
 *
 * THE BRAND IS LOAD-BEARING, not decoration. {@link Driven} separates a pose
 * from a reading by asking whether an operation returns the state, and an
 * unbranded empty type would swallow every reading — `GantrySnapshot` is
 * assignable to `{}`, so `snapshot` would be classified as a pose and reach a
 * validator as `() => Promise<void>`. A nominal brand makes the two disjoint, so
 * the classification is exactly the one `specs/instrumentation.md` states.
 */
declare const GANTRY_STATE: unique symbol;

/** The state `initialize` builds and every frame replaces (`specs/state.md`). */
export interface GantryState {
  readonly [GANTRY_STATE]: "the build's own GantryState";
}

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
  | "strut"
  | "cable"
  | "rail"
  | "ring"
  | "counterweight"
  | "delete";

/** The seven screens `specs/ui.md` gives. */
export type Screen =
  | "title"
  | "howto"
  | "select"
  | "build"
  | "program"
  | "run"
  | "results";

/** The four axes `specs/program.md` gives. */
export type AxisName = "slew" | "trolley" | "hoist" | "grip";

/** The two action steps a tape can carry (`specs/program.md`). */
export type TapeAction = "attach" | "release";

/** A structure's readiness issue (`specs/structure.md`). */
export type ReadinessIssue =
  | "no-ring"
  | "no-rail"
  | "invalid-rail"
  | "disconnected-members";

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
 *
 * The same three fields under every engine. Under this one the reading comes
 * from the engine's own `View.project`, which answers a fourth — the normalized
 * device depth — that the case's contract does not carry, so the harness drops
 * it: a check that could read a depth here would not compile against `none`.
 */
export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * A menu entry's hit region, in logical stage units.
 *
 * `specs/ui.md` leaves the menu layout to the build and fixes only that every
 * entry occupies one of these; `menuItemRect` is how a check finds where the
 * build drew an entry, so a check aims a press or a contact at the middle of
 * what the build reported and knows no menu coordinate of its own.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
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
 * The plain object `snapshot` returns.
 *
 * Transcribed from the Snapshot shape block of `specs/instrumentation.md`, which
 * is one block for all three engines. The shape is fixed and every field is
 * present whatever the screen, so nothing here is optional: a build that omits a
 * field fails the item that reads it, which is the verdict the specification asks
 * for.
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
/* The surface the build returns                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every operation `specs/instrumentation.md` requires of the surface the build's
 * `initialize` returns beside its state, in the order that file introduces them.
 *
 * Each takes the current state as its first parameter and then exactly the
 * parameters its table names and nothing else. A pose returns the next state; a
 * reading returns what it read. Nothing here is `async`: the state is a value in
 * this process and every operation is a plain function of it.
 *
 * THREE SECTIONS OF THAT FILE ARE ABSENT, and their absence is the contract
 * rather than an omission. `setAutoStep`/`advance` (the clock), `project` (the
 * projection) and the five input operations are written `{{#if (eq engine.slug
 * "none")}}`: "The clock, the keyboard, the pointer, the camera's projection,
 * and the overlay belong to the Simple 3D engine… and the surface carries no
 * operation for any of them." The harness supplies all three from the engine, as
 * `h.advance`, `h.project` and `h.keyDown`…, so a validator never learns that
 * they were engine-only there.
 */
/**
 * One thing a frame drew, as `specs/instrumentation.md` § Readings has `drawn()`
 * report it.
 *
 * A check that asks what the build DREW asks this and never the picture. The
 * reading is the frame's own description of what it put on screen, so it says
 * what a build chose — which model stands where, which marks are up, what colour
 * a member came out — without a validator ever reading a pixel, and without the
 * specification fixing a palette, a form or a layout.
 */
export interface DrawnEntry {
  readonly kind:
    | "model"
    | "member"
    | "aid"
    | "mark"
    | "obstacle"
    | "cable"
    | "ground"
    | "text";
  readonly name: string;
  readonly id: number | null;
  readonly source: string | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly size: readonly [number, number, number];
  readonly color: readonly [number, number, number];
  readonly text: string | null;
}

export interface GantryDebugApi {
  /* ---- Readings ----------------------------------------------------------- */

  snapshot(state: DeepReadonly<GantryState>): GantrySnapshot;
  /** The static check of `specs/structure.md`, computed on the spot. */
  check(state: DeepReadonly<GantryState>): CheckResult;
  /** What the last frame drew (`specs/instrumentation.md`). */
  drawn(): DrawnEntry[];
  /** The hit region of entry `index` of the menu the screen showing carries. */
  menuItemRect(state: DeepReadonly<GantryState>, index: number): MenuRect;

  /* ---- The run and the screens ------------------------------------------- */

  /** Returns the game to its title state, `muted` aside. */
  reset(state: DeepReadonly<GantryState>): GantryState;
  setScreen(state: DeepReadonly<GantryState>, screen: Screen): GantryState;
  setMenuIndex(state: DeepReadonly<GantryState>, index: number): GantryState;
  /**
   * Opens site `index`, locked or not: the opening `specs/state.md` fixes, and
   * nothing else. The screen is left exactly as it stands.
   */
  openSite(state: DeepReadonly<GantryState>, index: number): GantryState;
  setCleared(
    state: DeepReadonly<GantryState>,
    index: number,
    cleared: boolean,
  ): GantryState;
  setBest(
    state: DeepReadonly<GantryState>,
    index: number,
    cost: number,
    time: number,
  ): GantryState;
  clearBest(state: DeepReadonly<GantryState>, index: number): GantryState;
  setCamera(
    state: DeepReadonly<GantryState>,
    yaw: number,
    pitch: number,
    dist: number,
  ): GantryState;
  /** Poses the `run` action: the same refusals, the same `run-start`. */
  startRun(state: DeepReadonly<GantryState>): GantryState;
  /** Poses the abort: a running run ends with no verdict. */
  abortRun(state: DeepReadonly<GantryState>): GantryState;
  /** Poses the `check` action: the result is left showing on the build screen. */
  showCheck(state: DeepReadonly<GantryState>): GantryState;

  /* ---- The structure ------------------------------------------------------ */

  clearStructure(state: DeepReadonly<GantryState>): GantryState;
  addMember(
    state: DeepReadonly<GantryState>,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    material: MaterialName,
  ): GantryState;
  removeMember(state: DeepReadonly<GantryState>, id: number): GantryState;
  /** Places the slew ring by its base corner at that lattice node. */
  setRing(
    state: DeepReadonly<GantryState>,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  clearRing(state: DeepReadonly<GantryState>): GantryState;
  addCounterweight(
    state: DeepReadonly<GantryState>,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  removeCounterweight(
    state: DeepReadonly<GantryState>,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  setTool(state: DeepReadonly<GantryState>, tool: Tool): GantryState;
  setPendingNode(
    state: DeepReadonly<GantryState>,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  clearPendingNode(state: DeepReadonly<GantryState>): GantryState;

  /* ---- The tape ----------------------------------------------------------- */

  clearProgram(state: DeepReadonly<GantryState>): GantryState;
  /** Appends a move step carrying one command. */
  addMoveStep(
    state: DeepReadonly<GantryState>,
    axis: AxisName,
    target: number,
    rate: number,
  ): GantryState;
  /** Adds a command to the move step at `index`. */
  addCommand(
    state: DeepReadonly<GantryState>,
    index: number,
    axis: AxisName,
    target: number,
    rate: number,
  ): GantryState;
  addActionStep(
    state: DeepReadonly<GantryState>,
    action: TapeAction,
  ): GantryState;
  removeStep(state: DeepReadonly<GantryState>, index: number): GantryState;

  /* ---- The site ----------------------------------------------------------- */

  clearLoads(state: DeepReadonly<GantryState>): GantryState;
  addLoad(
    state: DeepReadonly<GantryState>,
    cls: LoadClass,
    mass: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): GantryState;
  setLoadTarget(
    state: DeepReadonly<GantryState>,
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): GantryState;
  clearObstacles(state: DeepReadonly<GantryState>): GantryState;
  addObstacle(
    state: DeepReadonly<GantryState>,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ): GantryState;

  /* ---- The run in progress ------------------------------------------------ */

  setAxis(
    state: DeepReadonly<GantryState>,
    axis: AxisName,
    value: number,
  ): GantryState;
  setAxisRate(
    state: DeepReadonly<GantryState>,
    axis: AxisName,
    rate: number,
  ): GantryState;
  setBob(
    state: DeepReadonly<GantryState>,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  setBobVelocity(
    state: DeepReadonly<GantryState>,
    vx: number,
    vy: number,
    vz: number,
  ): GantryState;
  setLoadPose(
    state: DeepReadonly<GantryState>,
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): GantryState;
  setLoadPhase(
    state: DeepReadonly<GantryState>,
    index: number,
    phase: LoadPhase,
  ): GantryState;
  /** Sets the watch speed to that index into `RUN_SPEEDS`. */
  setSpeedIndex(state: DeepReadonly<GantryState>, index: number): GantryState;
}

/* -------------------------------------------------------------------------- */
/* The surface a validator holds                                              */
/* -------------------------------------------------------------------------- */

/**
 * One member of the build's surface, as a check calls it.
 *
 * A pose `(state, ...args) => GantryState` becomes `(...args) => Promise<void>`:
 * the harness runs it through `engine.apply`, so the state it returns is the
 * state the next frame receives, and the caller "reads the outcome of any pose
 * back from `snapshot` rather than from a return value"
 * (`specs/instrumentation.md`). A reading `(state) => R` becomes
 * `() => Promise<R>`: the harness hands it `engine.state`.
 *
 * THE ASYNC IS THE POINT AND IT COSTS NOTHING. Nothing here crosses a process
 * boundary — every promise is already resolved — but the same operation under
 * `none` crosses into Chromium and genuinely is async, and one shape for both is
 * what lets a `<category>/<id>.test.ts` file grade three runtimes unchanged.
 */
type Driven<M> = M extends (
  state: DeepReadonly<GantryState>,
  ...args: infer A
) => GantryState
  ? (...args: A) => Promise<void>
  : M extends (state: DeepReadonly<GantryState>, ...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : M;

/**
 * The operations a validator reaches through `h.debug`.
 *
 * Every member of {@link GantryDebugApi}, minus its state argument, over the
 * engine that holds the state — which is member for member, parameter for
 * parameter, the `GantryDriver` `validation/none/surface.ts` declares. There is
 * nothing to subtract here: the clock, the projection and the input are the
 * ENGINE's under this build and were never on the surface to begin with, whereas
 * under `none` the surface carries them and the harness lifts them out.
 *
 * `snapshot` and `check` stay, exactly as they do there: they are lifted ONTO the
 * harness for convenience (`h.snapshot()`), not lifted OUT of the surface, and
 * every engine has them.
 */
export type GantryDriver = {
  [K in keyof GantryDebugApi]: Driven<GantryDebugApi[K]>;
};

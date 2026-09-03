// Gantry — the game.
//
// This module is the whole of the contract between the build and the engine:
// the state the game is written against (`specs/state.md`), the debug and
// automation surface a caller drives it from (`specs/instrumentation.md`), the
// stage background, and the three functions the engine calls.
//
// The state is a VALUE. The engine hands `update` the current state as a
// `DeepReadonly<GantryState>` and keeps whatever `update` returns as the next
// one, so a frame builds the next state from the current rather than writing
// into the one it was handed. Every operation of the debug surface is written
// in that same shape: a pose takes the current state and returns the next, a
// reading takes it and returns what it read.
//
// The work itself lives in the modules beside this one:
//
//   src/state.ts      the pure transitions and derived readings
//   src/edits.ts      the structure editor's rules, as transitions
//   src/pick.ts       what a click at the pointer would take
//   src/project.ts    where the camera stands, and where a world point draws
//   src/convert.ts    the state's records and `src/sim`'s, both ways
//   src/debug.ts      the surface `GantryDebugApi` names
//   src/app-tick.ts   one frame's update
//   src/assets.ts     the produced models and sounds
//   src/diagnostics.ts the values the overlay shows
//   src/screens.ts    the screens' response to an action
//   src/tape.ts       the tape editor's widgets and their edits
//   src/editor.ts     what a click does with the selected tool
//   src/render.ts     the yard and the readouts, one frame of each
//   src/render-posture.ts  where everything in the yard stands this frame
//   src/render-scene.ts    the yard in the engine's retained scene
//   src/render-hud.ts      the readouts on the engine's screen layer
//   src/render-format.ts   the words the readouts are made of
//   src/render-palette.ts  the look: every colour, weight, and face

import type {
  DeepReadonly,
  DiagnosticValue,
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-3d";
import { ACTIONS, BINDINGS, type CueName } from "./constants";
import type { Obstacle, SiteLoad } from "./constants";
import { loadProducedAssets } from "./assets";
import { updateGame } from "./app-tick";
import { createDebugSurface } from "./debug";
import { DIAGNOSTICS } from "./diagnostics";
import { drawFrame } from "./render";
import { titleState } from "./state";

// ---------------------------------------------------------------------------
// The state (`specs/state.md`)
// ---------------------------------------------------------------------------

/** A position, in world units; a lattice node carries lattice coordinates. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type MaterialName = "strut" | "cable" | "rail";

/** One member. `id` is unique for the life of a site's structure. */
export interface Member {
  id: number;
  a: Vec3;
  b: Vec3;
  material: MaterialName;
}

/** What the player has built on a site. */
export interface Structure {
  members: Member[];
  /** The next member id to assign; a removed member's is never given back. */
  nextMemberId: number;
  /** The slew ring, by its base corner (specs/structure.md), or none yet. */
  ring: { corner: Vec3 } | null;
  /** The nodes carrying a counterweight. */
  counterweights: Vec3[];
}

export type AxisName = "slew" | "trolley" | "hoist" | "grip";

export interface Command {
  axis: AxisName;
  target: number;
  rate: number;
}

/** One tape step: a move of one or more axes, or an action. */
export type Step =
  | { kind: "move"; commands: Command[] }
  | { kind: "action"; action: "attach" | "release" };

/** What the open site puts in the yard (specs/sites.md). */
export interface SiteState {
  loads: SiteLoad[];
  obstacles: Obstacle[];
}

/** A structure's readiness issue (specs/structure.md). */
export type ReadinessIssue =
  "no-ring" | "no-rail" | "invalid-rail" | "disconnected-members";

/** What would refuse a run: a readiness issue, or an empty tape. */
export type StartIssue = ReadinessIssue | "empty-program";

/** One member's solved force and utilization (specs/statics.md). */
export interface MemberForce {
  id: number;
  force: number;
  utilization: number;
}

/** What the static check reported (specs/structure.md). */
export interface CheckResult {
  issues: StartIssue[];
  cost: number;
  budget: number;
  stable: boolean;
  members: MemberForce[];
}

/** One axis during a run. `command` is null when no command is live on it. */
export interface AxisState {
  value: number;
  rate: number;
  command: { target: number; rate: number } | null;
}

export type LoadPhase = "waiting" | "attached" | "placed" | "lost";

/** One load during a run: one entry per load that run started with. */
export interface LoadState {
  phase: LoadPhase;
  /** The lift point's current position (specs/world.md). */
  pos: Vec3;
  yaw: number;
}

export type RunPhase = "idle" | "running" | "cleared" | "failed";

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

/**
 * The simulation's own per-run bookkeeping, kept beside the declared fields
 * above rather than among them.
 *
 * None of it is authoritative. `previousPivot`, `previousBobVel` and
 * `firstPendulumTick` are what the pendulum of `specs/rigging.md` reads about
 * the tick before this one; `brokeThisTick` is the fact the `break` cue reads;
 * the three peaks are readouts; `accumulator` is the frame time gathered and
 * not yet consumed as whole ticks, which belongs to the run and is empty when
 * one starts; and `lastCreakTick` is the `creak` cooldown of `specs/ui.md`.
 * The members a run still solves over are not here at all: they are the
 * structure's, less `broken`.
 */
export interface RunInternals {
  previousPivot: Vec3;
  previousBobVel: Vec3;
  firstPendulumTick: boolean;
  brokeThisTick: boolean;
  peakUtilization: number;
  peakTension: number;
  peakRingReaction: number;
  accumulator: number;
  lastCreakTick: number | null;
}

/** The run in progress, the run last ended, or the idle placeholder. */
export interface RunState {
  phase: RunPhase;
  /** The failure cause; null unless phase is "failed". */
  cause: FailCause | null;
  /** Ticks since the run started; the run clock is tick / TICK_HZ. */
  tick: number;
  /** Index into RUN_SPEEDS. */
  speedIndex: number;
  /** The tape step the run is on; the tape's length once all are done. */
  stepIndex: number;
  /** Whether that step is live: taken, and not yet complete. */
  stepLive: boolean;
  axes: {
    slew: AxisState;
    trolley: AxisState;
    hoist: AxisState;
    grip: AxisState;
  };
  /** The point the cable hangs from, at the latest tick's geometry. */
  pivot: Vec3;
  /** The pendulum bob: the hook point (specs/rigging.md). */
  bob: { pos: Vec3; vel: Vec3 };
  /** The attached load's index, or null. */
  attached: number | null;
  loads: LoadState[];
  /** The latest solve's, in member-id order, over the members still intact. */
  forces: MemberForce[];
  /** The ids of members broken so far this run, in the order they broke. */
  broken: number[];
  /** Build bookkeeping; see `RunInternals`. */
  internals: RunInternals;
}

/** A cleared site's recorded score. */
export interface Score {
  cost: number;
  time: number;
}

/** The orbit camera (specs/controls.md). */
export interface Camera {
  yaw: number;
  pitch: number;
  dist: number;
}

/** The pointer, as the frame read it (specs/controls.md). */
export interface PointerState {
  /** The pointer position, in the stage's logical units. */
  x: number;
  y: number;
  /** Whether a press is live. */
  down: boolean;
  /** Where the live press began, in those same units. */
  pressX: number;
  pressY: number;
  /** Whether the live press has reached CLICK_SLOP: an orbit drag. */
  dragging: boolean;
  /**
   * Build bookkeeping, not one of the six fields the snapshot reports:
   * whether the live press was taken by a tape widget on the program screen,
   * so it works that widget rather than the camera (specs/controls.md).
   */
  captured: boolean;
}

export type Screen =
  "title" | "howto" | "select" | "build" | "program" | "run" | "results";

export type Tool =
  "strut" | "cable" | "rail" | "ring" | "counterweight" | "delete";

/**
 * One sound a transition asked for, and where it is heard from.
 *
 * A transition is pure and the engine's audio is reachable from `update`
 * alone, so a transition that raises a cue leaves it here and the update that
 * runs next plays it and empties the queue. `at` is the world point it is
 * heard at, or null for a cue that belongs to no place.
 */
export interface RaisedCue {
  cue: CueName;
  at: Vec3 | null;
}

export interface GantryState {
  screen: Screen;
  /** The highlighted entry of the current screen's menu. */
  menuIndex: number;
  /** The site the yard screens show, counted from 0. */
  siteIndex: number;
  /** Per site: whether it has been cleared this session. */
  cleared: boolean[];
  /** Per site: the best recorded score, or null with none recorded. */
  best: (Score | null)[];
  /** Per site: the structure and tape authored on it, kept across visits. */
  sites: { structure: Structure; program: Step[] }[];
  /** The open site's loads and obstacles. */
  site: SiteState;
  /** The selected build tool. */
  tool: Tool;
  /** The held first node of a member placement, or null. */
  pendingNode: Vec3 | null;
  /**
   * The undo stack for the open site: the structure as it stood before each
   * structure-changing edit since the site was opened, oldest first.
   */
  history: Structure[];
  /** The check result the build screen is showing, or null. */
  checkResult: CheckResult | null;
  camera: Camera;
  pointer: PointerState;
  run: RunState;
  /** The engine's mute bit, mirrored every update. */
  muted: boolean;
  /** Accumulated delta time of every update, in seconds. */
  simTime: number;
  /**
   * Build bookkeeping: the cues raised since the last update played them.
   * Empty on the title state, so a `reset` empties it.
   */
  cues: RaisedCue[];
}

// ---------------------------------------------------------------------------
// The debug and automation surface (`specs/instrumentation.md`)
// ---------------------------------------------------------------------------

/** A world position, as the snapshot reports one. */
export interface PointReport {
  x: number;
  y: number;
  z: number;
}

/** A lift point and a yaw, as the snapshot reports one. */
export interface PoseReport extends PointReport {
  yaw: number;
}

export interface ScoreReport {
  cost: number;
  time: number;
}

export interface MemberForceReport {
  id: number;
  force: number;
  utilization: number;
}

/** What the static check reports (specs/structure.md). */
export interface CheckReport {
  issues: string[];
  cost: number;
  budget: number;
  stable: boolean;
  members: MemberForceReport[];
}

export interface MemberReport {
  id: number;
  a: PointReport;
  b: PointReport;
  material: MaterialName;
}

export interface LoadReport {
  class: SiteLoad["class"];
  mass: number;
  from: PoseReport;
  to: PoseReport;
}

export interface ObstacleReport {
  min: PointReport;
  size: PointReport;
}

export interface SiteReport {
  name: string;
  envelope: { min: PointReport; max: PointReport };
  anchors: PointReport[];
  budget: number;
  par: ScoreReport;
  loads: LoadReport[];
  obstacles: ObstacleReport[];
}

export interface StructureReport {
  members: MemberReport[];
  nextMemberId: number;
  ring: { corner: PointReport } | null;
  counterweights: PointReport[];
  cost: number;
  issues: string[];
}

export interface AxisReport {
  value: number;
  rate: number;
  command: { target: number; rate: number } | null;
}

export interface RunLoadReport {
  phase: LoadPhase;
  pos: PointReport;
  yaw: number;
}

export interface RunReport {
  phase: RunPhase;
  cause: string | null;
  tick: number;
  /** `tick / TICK_HZ`, seconds. */
  time: number;
  speedIndex: number;
  stepIndex: number;
  stepLive: boolean;
  axes: Record<AxisName, AxisReport>;
  pivot: PointReport;
  bob: { pos: PointReport; vel: PointReport };
  attached: number | null;
  loads: RunLoadReport[];
  forces: MemberForceReport[];
  broken: number[];
}

export interface PointerReport {
  x: number;
  y: number;
  down: boolean;
  pressX: number;
  pressY: number;
  dragging: boolean;
}

export interface PickReport {
  node: PointReport | null;
  member: number | null;
}

/** The fixed shape `snapshot` returns; every field is present on every screen. */
export interface Snapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  siteIndex: number;
  cleared: boolean[];
  best: (ScoreReport | null)[];
  site: SiteReport;
  tool: Tool;
  pendingNode: PointReport | null;
  historyDepth: number;
  camera: Camera;
  pointer: PointerReport;
  pick: PickReport;
  structure: StructureReport;
  program: Step[];
  checkResult: CheckReport | null;
  run: RunReport;
  muted: boolean;
  simTime: number;
}

/** The state as every operation of the surface receives it. */
export type ReadonlyGantryState = DeepReadonly<GantryState>;

/**
 * The debug and automation surface (`specs/instrumentation.md`).
 *
 * Each operation's first parameter is the current state, before the parameters
 * its table names. A pose returns the next `GantryState`, built from the one it
 * was handed and leaving that one as it was; a reading returns what it read.
 *
 * The clock, the input, and the projection belong to the engine, so this
 * surface carries no operation for any of them: a caller advances frames with
 * `engine.advance`, drives a control by dispatching a real event at the
 * engine's surface, and projects a world point with `engine.view().project`.
 */
export interface GantryDebugApi {
  /** `GANTRY_DEBUG_VERSION`. */
  readonly version: number;

  // ---- Readings -----------------------------------------------------------

  snapshot(state: ReadonlyGantryState): Snapshot;
  check(state: ReadonlyGantryState): CheckReport;

  // ---- The run and the screens -------------------------------------------

  reset(state: ReadonlyGantryState): GantryState;
  setScreen(state: ReadonlyGantryState, screen: string): GantryState;
  setMenuIndex(state: ReadonlyGantryState, index: number): GantryState;
  openSite(state: ReadonlyGantryState, index: number): GantryState;
  setCleared(
    state: ReadonlyGantryState,
    index: number,
    cleared: boolean,
  ): GantryState;
  setBest(
    state: ReadonlyGantryState,
    index: number,
    cost: number,
    time: number,
  ): GantryState;
  clearBest(state: ReadonlyGantryState, index: number): GantryState;
  setCamera(
    state: ReadonlyGantryState,
    yaw: number,
    pitch: number,
    dist: number,
  ): GantryState;
  startRun(state: ReadonlyGantryState): GantryState;
  abortRun(state: ReadonlyGantryState): GantryState;

  // ---- The structure ------------------------------------------------------

  clearStructure(state: ReadonlyGantryState): GantryState;
  addMember(
    state: ReadonlyGantryState,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    material: string,
  ): GantryState;
  removeMember(state: ReadonlyGantryState, id: number): GantryState;
  setRing(
    state: ReadonlyGantryState,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  clearRing(state: ReadonlyGantryState): GantryState;
  addCounterweight(
    state: ReadonlyGantryState,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  removeCounterweight(
    state: ReadonlyGantryState,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  setTool(state: ReadonlyGantryState, tool: string): GantryState;
  setPendingNode(
    state: ReadonlyGantryState,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  clearPendingNode(state: ReadonlyGantryState): GantryState;

  // ---- The tape -----------------------------------------------------------

  clearProgram(state: ReadonlyGantryState): GantryState;
  addMoveStep(
    state: ReadonlyGantryState,
    axis: string,
    target: number,
    rate: number,
  ): GantryState;
  addCommand(
    state: ReadonlyGantryState,
    index: number,
    axis: string,
    target: number,
    rate: number,
  ): GantryState;
  addActionStep(state: ReadonlyGantryState, action: string): GantryState;
  removeStep(state: ReadonlyGantryState, index: number): GantryState;

  // ---- The site -----------------------------------------------------------

  clearLoads(state: ReadonlyGantryState): GantryState;
  addLoad(
    state: ReadonlyGantryState,
    cls: string,
    mass: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): GantryState;
  setLoadTarget(
    state: ReadonlyGantryState,
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): GantryState;
  clearObstacles(state: ReadonlyGantryState): GantryState;
  addObstacle(
    state: ReadonlyGantryState,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ): GantryState;

  // ---- The run in progress ------------------------------------------------

  setAxis(state: ReadonlyGantryState, axis: string, value: number): GantryState;
  setAxisRate(
    state: ReadonlyGantryState,
    axis: string,
    rate: number,
  ): GantryState;
  setBob(
    state: ReadonlyGantryState,
    x: number,
    y: number,
    z: number,
  ): GantryState;
  setBobVelocity(
    state: ReadonlyGantryState,
    vx: number,
    vy: number,
    vz: number,
  ): GantryState;
  setLoadPose(
    state: ReadonlyGantryState,
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): GantryState;
  setLoadPhase(
    state: ReadonlyGantryState,
    index: number,
    phase: string,
  ): GantryState;
  setSpeedIndex(state: ReadonlyGantryState, index: number): GantryState;
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

/**
 * The stage background, a CSS color string: the deep blue-black the yard's sky
 * dome sits against, which the engine clears the whole canvas to so the
 * letterbox bars match the picture. The look is `src/render-palette.ts`'s, and
 * this is the one value of it `src/main.ts` needs.
 */
export { BACKGROUND } from "./render-palette";

/** The game this build's engine drives. */
export const game: Game<GantryState, GantryDebugApi> = {
  /**
   * Runs once, before any frame: register the actions, back every cue with the
   * file `specs/assets.md` produces for it, load the produced models, register
   * the diagnostic sources, and build the whole title-screen state.
   */
  async initialize(
    api: InitApi<GantryState>,
  ): Promise<[GantryState, GantryDebugApi]> {
    for (const name of ACTIONS) {
      api.input.register(name, { keys: [...BINDINGS[name]] });
    }
    for (const source of DIAGNOSTICS) {
      api.diagnostics.register(
        source.name,
        (state: DeepReadonly<GantryState>): DiagnosticValue =>
          source.read(state),
      );
    }
    await loadProducedAssets(api);
    return [titleState(), createDebugSurface()];
  },

  /** Runs once per frame, before `render`: the next state from the current. */
  update(
    state: DeepReadonly<GantryState>,
    api: UpdateApi,
    dt: number,
  ): GantryState {
    return updateGame(state, api, dt);
  },

  /** Runs once per frame, after `update`, over the state it returned. */
  render(state: DeepReadonly<GantryState>, api: RenderApi): void {
    drawFrame(state, api);
  },
};

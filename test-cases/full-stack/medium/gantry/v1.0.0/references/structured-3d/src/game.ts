// Gantry — the game.
//
// This file is the declaration and the wiring. `specs/state.md` fixes the state
// the whole game is written against and `specs/instrumentation.md` the debug
// surface that poses and reads it, and both are declared here, under the names
// the rest of the build imports. Below them is the definition the engine is
// bound to: the game instance that outlives the world, the single level the game
// runs in, and the game mode and player controller that run it.
//
// Everything that decides anything lives beside this file: `src/state.ts` writes
// the state, `src/editor.ts` picks and edits the structure, `src/screens.ts`
// runs the screens, `src/app-tick.ts` is what a frame does, `src/debug.ts`
// builds the surface, `src/view.ts` is where the camera stands, `src/scene.ts`
// draws the yard, and `src/sim` is the whole of the simulation.

import {
  GameInstance,
  GameMode,
  GameState,
  PlayerController,
  vec3,
} from "@clockwyrks/structured-3d";
import type { GameDefinition, InitApi } from "@clockwyrks/structured-3d";
import {
  ACTIONS,
  BINDINGS,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  CAMERA_TARGET,
  CUES,
  HOIST_START,
  SITES,
  SITE_COUNT,
  type LoadClass,
  type Obstacle,
  type SiteLoad,
} from "./constants";
import type { Member as SimMember, Vec3 as SimVec3 } from "./sim";
import { loadModels, setModels } from "./assets";
import { createDebugSurface } from "./debug";
import { MUSIC_CUE, worldIo, type GameIo } from "./io";
import {
  diagnosticSources,
  noCapture,
  readInput,
  updateFrame,
  type PressCapture,
} from "./app-tick";
import { CAMERA_FOV, cameraPosition } from "./view";
import { STAGE_BACKGROUND } from "./palette";
import { refreshViews, spawnReadouts, spawnScene } from "./scene";
import type { DrawnEntry } from "./render-drawn";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the whole canvas is cleared to each frame, so the
 * letterbox bars around the stage match the yard's sky.
 */
export const BACKGROUND = STAGE_BACKGROUND;

// ===========================================================================
// The state (`specs/state.md`)
// ===========================================================================

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
}

/**
 * The run as the game carries it: every field `RunState` declares above, under
 * its declared name, type, and meaning, and beside them the per-tick
 * bookkeeping the seven-stage pipeline of `specs/program.md` needs from one
 * tick to the next and the frame loop needs from one frame to the next.
 *
 * None of the extra fields is authoritative and none is reported: each is
 * either a value the pipeline itself produced on the tick before — the previous
 * pivot the pendulum reads, the previous bob velocity, whether a pendulum step
 * has run, the members still intact, whether this tick's cascade broke any, the
 * latest ring reactions, and the peaks a solve tracks — or the bookkeeping of
 * what the frame presents: the time gathered and not yet consumed as whole
 * ticks, and the tick the last `creak` played on. `reset` and every idle run put
 * all of them back with the declared ones.
 */
export interface GameRun extends RunState {
  /** The pivot the pendulum reads as the previous one (specs/rigging.md). */
  previousPivot: Vec3;
  /** The bob velocity the tick's acceleration is measured against. */
  previousBobVelocity: Vec3;
  /** No pendulum step has run yet, so the bob's acceleration is zero. */
  firstPendulumTick: boolean;
  /**
   * The members the run still solves over: the structure's, less `broken`, in
   * the shape `src/sim` reads them.
   */
  intact: readonly SimMember[];
  /** Whether this tick's cascade broke members — what the `break` cue reads. */
  brokeThisTick: boolean;
  /** The latest solve's ring corner reactions, one per corner. */
  ringReactions: readonly SimVec3[];
  peakUtilization: number;
  peakTension: number;
  peakRingReaction: number;
  /** Frame time gathered and not yet consumed as whole ticks; `0` at a start. */
  accumulator: number;
  /** The tick the last `creak` played on, or `null` with none this run. */
  lastCreakTick: number | null;
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
}

export type Screen =
  "title" | "howto" | "select" | "build" | "program" | "run" | "results";

export type Tool =
  "strut" | "cable" | "rail" | "ring" | "counterweight" | "delete";

export class GantryState extends GameState {
  screen: Screen = "title";
  menuIndex = 0;

  siteIndex = 0;
  cleared: boolean[] = Array.from({ length: SITE_COUNT }, () => false);
  best: (Score | null)[] = Array.from({ length: SITE_COUNT }, () => null);
  sites: { structure: Structure; program: Step[] }[] = Array.from(
    { length: SITE_COUNT },
    () => ({
      structure: {
        members: [],
        nextMemberId: 0,
        ring: null,
        counterweights: [],
      },
      program: [],
    }),
  );

  site: SiteState = {
    loads: SITES[0].loads.map((load) => ({
      ...load,
      from: { ...load.from },
      to: { ...load.to },
    })),
    obstacles: SITES[0].obstacles.map((box) => ({
      min: { ...box.min },
      size: { ...box.size },
    })),
  };

  tool: Tool = "strut";
  pendingNode: Vec3 | null = null;
  history: Structure[] = [];
  checkResult: CheckResult | null = null;

  camera: Camera = {
    yaw: CAMERA_START_YAW,
    pitch: CAMERA_START_PITCH,
    dist: CAMERA_START_DIST,
  };

  pointer: PointerState = {
    x: 0,
    y: 0,
    down: false,
    pressX: 0,
    pressY: 0,
    dragging: false,
  };

  run: GameRun = {
    phase: "idle",
    cause: null,
    tick: 0,
    speedIndex: 0,
    stepIndex: 0,
    stepLive: false,
    axes: {
      slew: { value: 0, rate: 0, command: null },
      trolley: { value: 0, rate: 0, command: null },
      hoist: { value: HOIST_START, rate: 0, command: null },
      grip: { value: 0, rate: 0, command: null },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bob: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    attached: null,
    loads: [],
    forces: [],
    broken: [],
    previousPivot: { x: 0, y: 0, z: 0 },
    previousBobVelocity: { x: 0, y: 0, z: 0 },
    firstPendulumTick: true,
    intact: [],
    brokeThisTick: false,
    ringReactions: [],
    peakUtilization: 0,
    peakTension: 0,
    peakRingReaction: 0,
    accumulator: 0,
    lastCreakTick: null,
  };

  muted = false;
  simTime = 0;
}

// ===========================================================================
// The debug and automation surface (`specs/instrumentation.md`)
// ===========================================================================

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

/** What the static check reports (`specs/structure.md`). */
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
  class: LoadClass;
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
  axes: {
    slew: AxisReport;
    trolley: AxisReport;
    hoist: AxisReport;
    grip: AxisReport;
  };
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
/** A menu entry's hit region, in logical stage units. */
export interface MenuRectReport {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

/**
 * The whole surface (`specs/instrumentation.md`).
 *
 * The engine holds what the instance's `initialize` returned and hands it back
 * from `engine.debug`; nothing is installed on the page. Each operation acts on
 * the live world at the moment of the call: a pose takes only the parameters its
 * table names, returns nothing, and changes the world; a reading returns what it
 * read and changes nothing.
 *
 * The clock, the keyboard, the pointer, the camera's projection, and the
 * overlay belong to the engine, so this surface carries no operation for any of
 * them.
 */
export interface GantryDebugApi {
  readonly version: number;

  // Readings
  snapshot(): Snapshot;
  check(): CheckReport;
  drawn(): DrawnEntry[];
  menuItemRect(index: number): MenuRectReport;

  // The run and the screens
  reset(): void;
  setScreen(screen: string): void;
  setMenuIndex(index: number): void;
  openSite(index: number): void;
  setCleared(index: number, cleared: boolean): void;
  setBest(index: number, cost: number, time: number): void;
  clearBest(index: number): void;
  setCamera(yaw: number, pitch: number, dist: number): void;
  startRun(): void;
  abortRun(): void;
  showCheck(): void;

  // The structure
  clearStructure(): void;
  addMember(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    material: string,
  ): void;
  removeMember(id: number): void;
  setRing(x: number, y: number, z: number): void;
  clearRing(): void;
  addCounterweight(x: number, y: number, z: number): void;
  removeCounterweight(x: number, y: number, z: number): void;
  setTool(tool: string): void;
  setPendingNode(x: number, y: number, z: number): void;
  clearPendingNode(): void;

  // The tape
  clearProgram(): void;
  addMoveStep(axis: string, target: number, rate: number): void;
  addCommand(index: number, axis: string, target: number, rate: number): void;
  addActionStep(action: string): void;
  removeStep(index: number): void;

  // The site
  clearLoads(): void;
  addLoad(
    cls: string,
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

  // The run in progress
  setAxis(axis: string, value: number): void;
  setAxisRate(axis: string, rate: number): void;
  setBob(x: number, y: number, z: number): void;
  setBobVelocity(vx: number, vy: number, vz: number): void;
  setLoadPose(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void;
  setLoadPhase(index: number, phase: string): void;
  setSpeedIndex(index: number): void;
}

// ===========================================================================
// The game
// ===========================================================================

/**
 * Where the frame's actions and the pointer are read. Controllers tick before
 * any actor, so what this writes is what the rest of the frame reads.
 */
class GantryController extends PlayerController {
  private readonly io: GameIo = worldIo(() => this.world);
  private readonly press: PressCapture = noCapture();

  override tick(dt: number): void {
    readInput(
      this.world.state as GantryState,
      this.input,
      dt,
      this.io,
      this.press,
    );
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the lattice
 * editor and the tape editor, the run and its fixed tick, the orbit camera, the
 * single player, and the per-frame bookkeeping the specification asks of every
 * tick.
 */
class GantryMode extends GameMode {
  declare readonly state: GantryState;

  override gameStateClass = GantryState;
  override playerControllerClass = GantryController;
  override pawnClass = null;

  private readonly io: GameIo = worldIo(() => this.world);

  override beginPlay(): void {
    // One player, possessing nothing: the yard is worked with the pointer and
    // the keyboard rather than driven through a pawn.
    this.addPlayer({ name: "Operator" });

    // The picture: the yard in the world pass, the readouts in the screen pass
    // over it (`src/scene.ts`). Both are actors carrying render components, and
    // both hold nothing authoritative — each is handed the state once a frame.
    spawnScene(this.world);
    spawnReadouts(this.world);

    for (const [name, source] of diagnosticSources(() => this.state)) {
      this.world.diagnostics.register(name, source);
    }
  }

  override tick(dt: number): void {
    updateFrame(this.state, dt, this.io);
    this.poseCamera();
    // Last, so what is drawn is the state this frame left rather than the one
    // the frame before it did: the mode ticks after every actor.
    refreshViews(this.world);
  }

  /**
   * The world camera, from the orbit pose the state holds: the lens
   * `src/view.ts` names, the eye `specs/controls.md` fixes, and `CAMERA_TARGET`
   * to look at. Picking measures through the same figures, so what a click
   * takes is what the frame drew.
   */
  private poseCamera(): void {
    const at = cameraPosition(this.state.camera);
    const camera = this.world.camera;
    camera.fov = CAMERA_FOV;
    camera.position = vec3(at[0], at[1], at[2]);
    camera.lookAt(vec3(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z));
  }
}

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. It registers every
 * action against its bindings, backs each cue with the file `specs/assets.md`
 * produces for it, loads the eight produced models, and returns the debug
 * surface the engine hands back from `engine.debug`.
 */
class GantryInstance extends GameInstance<GantryDebugApi> {
  private readonly io: GameIo = worldIo(() => this.engine.world);

  override async initialize(api: InitApi): Promise<GantryDebugApi> {
    for (const action of ACTIONS) {
      api.input.register(action, { keys: [...BINDINGS[action]] });
    }

    await Promise.all([
      ...CUES.map((cue) => api.audio.load(cue, `audio/${cue}.wav`)),
      api.audio.load(MUSIC_CUE, "audio/music.wav"),
    ]);

    setModels(await loadModels(api.assets));

    return createDebugSurface({
      state: () => this.engine.world.state as GantryState,
      io: this.io,
    });
  }
}

/**
 * The game this build's engine drives: one level, opened once, in which every
 * screen is a value of the state's `screen` field.
 */
export const game: GameDefinition<GantryDebugApi> = {
  instance: GantryInstance,
  levels: { yard: { mode: GantryMode } },
  startLevel: "yard",
};

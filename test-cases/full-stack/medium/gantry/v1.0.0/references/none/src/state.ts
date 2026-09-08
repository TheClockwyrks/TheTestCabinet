// Gantry's state: the one value the frame loop advances, and the pure
// transitions over it.
//
// The build owns the shape (`specs/state.md`, the engineless branch), and this
// is it. Every field is plain data — numbers, strings, booleans, and containers
// of them — so a state can be built, posed, and read back field by field, which
// is what the debug surface of `specs/instrumentation.md` rests on. Positions
// are the simulation's own `Vec3` triples, so the state feeds `src/sim`
// directly; `src/debug.ts` is the one place that turns them into the
// `{ x, y, z }` objects the snapshot reports.
//
// Nothing here renders, reads input, or plays a sound: a transition takes a
// state and returns the next one, and a transition the game's own rules refuse
// returns the state it was handed, unchanged.

import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  RESULTS_ITEMS,
  SITE_COUNT,
  TITLE_ITEMS,
} from "./constants";
import {
  AXES,
  cost as structureCost,
  idleRun as simIdleRun,
  SIM_SITES,
  startRun as simStartRun,
  type AxisName,
  type AxisState,
  type Box,
  type CheckResult,
  type LoadClass,
  type LoadPhase,
  type Member,
  type Pose,
  type Ring,
  type RunState as SimRunState,
  type SimSite,
  type SiteLoad,
  type TapeStep,
  type Vec3,
} from "./sim";

// ---- The vocabularies the screens and the editor are written against -------

/** The seven screens of `specs/ui.md`. */
export type Screen =
  | "title"
  | "howto"
  | "select"
  | "build"
  | "program"
  | "run"
  | "results";

/** The six build tools of `specs/controls.md`. */
export type Tool =
  | "strut"
  | "cable"
  | "rail"
  | "ring"
  | "counterweight"
  | "delete";

export const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "select",
  "build",
  "program",
  "run",
  "results",
];

export const TOOLS: readonly Tool[] = [
  "strut",
  "cable",
  "rail",
  "ring",
  "counterweight",
  "delete",
];

/** Whether a string names a screen, for reading a posed or stored value. */
export const isScreen = (name: string): name is Screen =>
  (SCREENS as readonly string[]).includes(name);

/** Whether a string names a build tool. */
export const isTool = (name: string): name is Tool =>
  (TOOLS as readonly string[]).includes(name);

/** The three yard screens, which show the 3D scene and the orbit camera. */
export const isYardScreen = (screen: Screen): boolean =>
  screen === "build" || screen === "program" || screen === "run";

// ---- The pieces of the state ----------------------------------------------

/** A cleared site's recorded score. */
export interface Score {
  cost: number;
  time: number;
}

/**
 * What the player has built on one site: the simulation's structure, plus the
 * id bookkeeping the editor keeps. Removing a member never gives its id back,
 * so `nextMemberId` does not follow from `members`; only emptying the structure
 * whole returns it to `0` (`specs/instrumentation.md`).
 */
export interface SiteStructure {
  members: Member[];
  nextMemberId: number;
  ring: Ring | null;
  counterweights: Vec3[];
}

/** The structure and the tape authored on one site, kept across visits. */
export interface SiteAuthoring {
  structure: SiteStructure;
  program: TapeStep[];
}

/**
 * What the open site puts in the yard: the state's own copies, so nothing here
 * points into the fixed table `specs/sites.md` gives. The site's name,
 * envelope, anchors, budget, and par are not carried; they are read by the site
 * index against that table.
 */
export interface OpenSite {
  loads: SiteLoad[];
  obstacles: Box[];
}

/** The orbit camera's pose (`specs/controls.md`). */
export interface Camera {
  yaw: number;
  pitch: number;
  dist: number;
}

/**
 * The pointer, as the state has been following it. `x` and `y` are refreshed
 * from the runtime on every update; the rest are the state's own record of the
 * press it is following, so a click and an orbit drag are told apart by what
 * the state kept (`specs/controls.md`).
 */
export interface Pointer {
  /** The pointer position, in the stage's logical units. */
  x: number;
  y: number;
  /** Whether a press is live. */
  down: boolean;
  /** Where the live press began, in those same units. */
  pressX: number;
  pressY: number;
  /** Whether the live press has reached `CLICK_SLOP`: an orbit drag. */
  dragging: boolean;
  /**
   * Build bookkeeping, not part of the six fields the snapshot reports:
   * whether the live press was taken by a tape widget on the program screen,
   * so it works that widget rather than the camera (`specs/controls.md`).
   */
  captured: boolean;
}

/**
 * The run in progress, the run last ended, or the idle placeholder.
 *
 * The simulation's own run state, which carries every fact `specs/state.md`
 * fixes, plus three the frame loop and the cues keep beside it. None of the
 * three is authoritative: `speedIndex` is the watch speed the snapshot reports,
 * `accumulator` is the tick accumulator that belongs to the run, and
 * `lastCreakTick` is the `creak` cooldown of `specs/ui.md`.
 */
export interface GameRun extends SimRunState {
  /** The watch speed, as an index into `RUN_SPEEDS`. */
  speedIndex: number;
  /** Frame time gathered and not yet consumed as whole ticks; `0` at a start. */
  accumulator: number;
  /** The tick the last `creak` played on, or `null` with none this run. */
  lastCreakTick: number | null;
}

/** The whole of Gantry's state. */
export interface GantryState {
  /** The screen currently shown. */
  screen: Screen;
  /** The highlighted entry of whichever menu `screen` shows, counted from `0`. */
  menuIndex: number;
  /** The site the yard screens show, and `0` before any site has been opened. */
  siteIndex: number;
  /** One entry per site: whether it has been cleared this session. */
  cleared: boolean[];
  /** One entry per site: its best recorded score, or `null` with none. */
  best: (Score | null)[];
  /** One entry per site: the structure and tape authored on it. */
  sites: SiteAuthoring[];
  /** The open site's loads and obstacles. */
  site: OpenSite;
  /** The selected build tool. */
  tool: Tool;
  /** The held first node of a member placement, or `null`. */
  pendingNode: Vec3 | null;
  /**
   * The undo stack for the open site: the structure as it stood before each
   * structure-changing edit since the site was opened, oldest first.
   */
  history: SiteStructure[];
  /** The check result the build screen is showing, or `null`. */
  checkResult: CheckResult | null;
  camera: Camera;
  pointer: Pointer;
  run: GameRun;
  /** The game's readable copy of the runtime's mute bit. */
  muted: boolean;
  /** Accumulated delta time of every update, in seconds, whatever the screen. */
  simTime: number;
}

// ---- Small copies ----------------------------------------------------------

const copyVec = (p: Vec3): Vec3 => [p[0], p[1], p[2]];

const copyPose = (pose: Pose): Pose => ({
  pos: copyVec(pose.pos),
  yaw: pose.yaw,
});

const copyLoad = (load: SiteLoad): SiteLoad => ({
  cls: load.cls,
  mass: load.mass,
  from: copyPose(load.from),
  to: copyPose(load.to),
});

const copyBox = (box: Box): Box => ({
  min: copyVec(box.min),
  max: copyVec(box.max),
});

/** A structure copied deeply enough that neither copy can be changed through
 * the other, which is what the undo stack holds. */
export function copyStructure(structure: SiteStructure): SiteStructure {
  return {
    members: structure.members.map((m) => ({
      id: m.id,
      a: copyVec(m.a),
      b: copyVec(m.b),
      material: m.material,
    })),
    nextMemberId: structure.nextMemberId,
    ring: structure.ring ? { corner: copyVec(structure.ring.corner) } : null,
    counterweights: structure.counterweights.map(copyVec),
  };
}

/** An empty crane, which is what a site nothing has been built on carries. */
export const emptySiteStructure = (): SiteStructure => ({
  members: [],
  nextMemberId: 0,
  ring: null,
  counterweights: [],
});

// ---- Derived readings ------------------------------------------------------

/**
 * The open site as the simulation reads it: the fixed table's figures for this
 * site index, carrying the loads and obstacles the state is holding, which the
 * site poses of `specs/instrumentation.md` may have replaced.
 */
export function currentSite(state: GantryState): SimSite {
  const base = SIM_SITES[state.siteIndex];
  return {
    ...base,
    loads: state.site.loads,
    obstacles: state.site.obstacles,
  };
}

/** The structure authored on the open site. */
export const currentStructure = (state: GantryState): SiteStructure =>
  state.sites[state.siteIndex].structure;

/** The tape authored on the open site. */
export const currentProgram = (state: GantryState): TapeStep[] =>
  state.sites[state.siteIndex].program;

/** The open crane's cost (`specs/structure.md`). */
export const craneCost = (state: GantryState): number =>
  structureCost(currentStructure(state));

/**
 * Whether a site is open to enter: site `0` always, and site `n + 1` once site
 * `n` has been cleared (`specs/ui.md`).
 */
export const siteUnlocked = (state: GantryState, index: number): boolean =>
  index === 0 || state.cleared[index - 1] === true;

/** The results menu, which drops `NEXT SITE` on the last site (`specs/ui.md`). */
export const resultsItems = (siteIndex: number): readonly string[] =>
  siteIndex >= SITE_COUNT - 1 ? RESULTS_ITEMS.slice(1) : RESULTS_ITEMS.slice();

/**
 * How many entries the menu on the screen showing has, and `0` on a screen
 * with no menu — `howto`, `build`, `program`, and `run`.
 */
export function menuLength(state: GantryState): number {
  switch (state.screen) {
    case "title":
      return TITLE_ITEMS.length;
    case "select":
      return SITE_COUNT;
    case "results":
      return resultsItems(state.siteIndex).length;
    default:
      return 0;
  }
}

/**
 * The entry `confirm` would take and `up` and `down` would move from: a menu
 * with no entry at `menuIndex` highlights its last entry instead
 * (`specs/state.md`).
 */
export function highlightedIndex(state: GantryState): number {
  const count = menuLength(state);
  if (count === 0) return state.menuIndex;
  return Math.min(Math.max(state.menuIndex, 0), count - 1);
}

// ---- The camera ------------------------------------------------------------

/**
 * A camera pose held to its limits, exactly as the orbit controls hold it: the
 * pitch and the distance clamped, and the yaw wrapped to at or above `0` and
 * below `360` (`specs/controls.md`).
 */
export function poseCamera(yaw: number, pitch: number, dist: number): Camera {
  return {
    yaw: ((yaw % 360) + 360) % 360,
    pitch: Math.min(CAMERA_PITCH_MAX, Math.max(CAMERA_PITCH_MIN, pitch)),
    dist: Math.min(CAMERA_DIST_MAX, Math.max(CAMERA_DIST_MIN, dist)),
  };
}

/** The camera pose a site opening returns to. */
export const startCamera = (): Camera =>
  poseCamera(CAMERA_START_YAW, CAMERA_START_PITCH, CAMERA_START_DIST);

/** Set the camera, holding it inside its limits. */
export const setCamera = (
  state: GantryState,
  yaw: number,
  pitch: number,
  dist: number,
): GantryState => ({ ...state, camera: poseCamera(yaw, pitch, dist) });

// ---- The run ---------------------------------------------------------------

/**
 * The idle placeholder `specs/state.md` fixes: what the run carries before a
 * site's first run, and what opening a site, aborting, and a `reset` put back.
 */
export const idleRun = (): GameRun => ({
  ...simIdleRun(),
  speedIndex: 0,
  accumulator: 0,
  lastCreakTick: null,
});

/**
 * Start a run on the open site, or refuse it.
 *
 * Refused exactly as the `run` action is — a readiness issue or an empty tape —
 * in which case the state comes back unchanged and no run begins. A run that
 * begins carries what `specs/state.md` tabulates for a start, at watch speed
 * `0` with an empty accumulator, and the run screen is shown.
 */
export function beginRun(state: GantryState): GantryState | null {
  const started = simStartRun({
    site: currentSite(state),
    structure: currentStructure(state),
    tape: currentProgram(state),
  });
  if (started === null) return null;
  return {
    ...state,
    screen: "run",
    run: { ...started, speedIndex: 0, accumulator: 0, lastCreakTick: null },
  };
}

/**
 * Abort a run in progress: it ends with no verdict, the run goes back to its
 * idle placeholder, and the build screen returns (`specs/program.md`). A state
 * with no run in progress comes back unchanged.
 */
export function abortRun(state: GantryState): GantryState {
  if (state.run.phase !== "running") return state;
  return { ...state, screen: "build", run: idleRun() };
}

/** The run's tick count, from which the run clock follows. */
export const setRunTick = (state: GantryState, tick: number): GantryState => ({
  ...state,
  run: { ...state.run, tick },
});

/** The watch speed, as an index into `RUN_SPEEDS`. */
export const setSpeedIndex = (
  state: GantryState,
  index: number,
): GantryState => ({ ...state, run: { ...state.run, speedIndex: index } });

const copyAxes = (
  axes: Record<AxisName, AxisState>,
): Record<AxisName, AxisState> => ({
  slew: { ...axes.slew },
  trolley: { ...axes.trolley },
  hoist: { ...axes.hoist },
  grip: { ...axes.grip },
});

/** Set an axis's value, leaving it stopped with no live command. */
export function setAxis(
  state: GantryState,
  axis: AxisName,
  value: number,
): GantryState {
  const axes = copyAxes(state.run.axes);
  axes[axis] = { value, rate: 0, command: null };
  return { ...state, run: { ...state.run, axes } };
}

/** Set an axis's signed rate, leaving its value and its command as they are. */
export function setAxisRate(
  state: GantryState,
  axis: AxisName,
  rate: number,
): GantryState {
  const axes = copyAxes(state.run.axes);
  axes[axis] = { ...axes[axis], rate };
  return { ...state, run: { ...state.run, axes } };
}

/** Put the pendulum bob at a world position. */
export const setBob = (state: GantryState, pos: Vec3): GantryState => ({
  ...state,
  run: { ...state.run, bob: { pos, vel: state.run.bob.vel } },
});

/** Set the bob's velocity. */
export const setBobVelocity = (state: GantryState, vel: Vec3): GantryState => ({
  ...state,
  run: { ...state.run, bob: { pos: state.run.bob.pos, vel } },
});

/** Put a load's lift point at a world position, at that yaw. */
export function setLoadPose(
  state: GantryState,
  index: number,
  pos: Vec3,
  yaw: number,
): GantryState {
  const loads = state.run.loads.map((l, i) =>
    i === index ? { ...l, pos, yaw } : { ...l },
  );
  return { ...state, run: { ...state.run, loads } };
}

/**
 * Set a load's phase.
 *
 * `"attached"` hangs it on the hook exactly as a successful `attach` leaves it,
 * without the candidate search and without the `attach-missed` verdict, and is
 * refused while another load is attached. The grip is left as it is. Every
 * other phase takes the load off the hook, so the attachment clears when the
 * load posed was the one hanging, and `"placed"` sets it down at exactly its
 * target pose (`specs/instrumentation.md`).
 */
export function setLoadPhase(
  state: GantryState,
  index: number,
  phase: LoadPhase,
): GantryState {
  const run = state.run;
  if (phase === "attached" && run.attached !== null && run.attached !== index) {
    return state;
  }
  const target = currentSite(state).loads[index];
  const loads = run.loads.map((l, i) => {
    if (i !== index) return { ...l };
    if (phase === "placed" && target !== undefined) {
      return { phase, pos: copyVec(target.to.pos), yaw: target.to.yaw };
    }
    return { ...l, phase };
  });
  const attached =
    phase === "attached" ? index : run.attached === index ? null : run.attached;
  return { ...state, run: { ...run, loads, attached } };
}

// ---- The editor's selection -------------------------------------------------

/**
 * Select a build tool, as the tool actions do. A pending node belongs to the
 * placement rather than the tool, so it survives every switch
 * (`specs/controls.md`).
 */
export const setTool = (state: GantryState, tool: Tool): GantryState => ({
  ...state,
  tool,
});

/**
 * Hold a lattice node as the pending first node of a member placement, as a
 * first click does.
 */
export const setPendingNode = (
  state: GantryState,
  node: Vec3,
): GantryState => ({ ...state, pendingNode: node });

/** Clear the pending node without placing, as `back` does. */
export const clearPendingNode = (state: GantryState): GantryState =>
  state.pendingNode === null ? state : { ...state, pendingNode: null };

// ---- The tape --------------------------------------------------------------

/** Whether the tape editor accepts a rate on an axis (`specs/program.md`). */
export const acceptableRate = (axis: AxisName, rate: number): boolean =>
  Number.isFinite(rate) && rate > 0 && rate <= AXES[axis].maxRate;

const withProgram = (state: GantryState, program: TapeStep[]): GantryState => ({
  ...state,
  sites: state.sites.map((entry, i) =>
    i === state.siteIndex ? { ...entry, program } : entry,
  ),
  // The check result stands only until the structure or the tape changes
  // (`specs/structure.md`).
  checkResult: null,
});

/** Empty the open site's tape. A tape already empty is left as it stands. */
export const clearProgram = (state: GantryState): GantryState =>
  currentProgram(state).length === 0 ? state : withProgram(state, []);

/**
 * Append a move step carrying one command. Refused, silently, when the tape
 * editor would refuse the rate.
 */
export function addMoveStep(
  state: GantryState,
  axis: AxisName,
  target: number,
  rate: number,
): GantryState {
  if (!acceptableRate(axis, rate)) return state;
  return withProgram(state, [
    ...currentProgram(state),
    { kind: "move", commands: [{ axis, target, rate }] },
  ]);
}

/**
 * Add a command to the move step at `index`. Refused, silently, on an action
 * step, on an axis that step already commands, and on a rate the editor
 * refuses.
 */
export function addCommand(
  state: GantryState,
  index: number,
  axis: AxisName,
  target: number,
  rate: number,
): GantryState {
  const program = currentProgram(state);
  const step = program[index];
  if (step === undefined || step.kind !== "move") return state;
  if (!acceptableRate(axis, rate)) return state;
  if (step.commands.some((c) => c.axis === axis)) return state;
  const next = program.slice();
  next[index] = {
    kind: "move",
    commands: [...step.commands, { axis, target, rate }],
  };
  return withProgram(state, next);
}

/** Append an action step. */
export const addActionStep = (
  state: GantryState,
  action: "attach" | "release",
): GantryState =>
  withProgram(state, [...currentProgram(state), { kind: "action", action }]);

/** Remove the step at `index`. An index the tape does not carry removes none. */
export function removeStep(state: GantryState, index: number): GantryState {
  const program = currentProgram(state);
  if (index < 0 || index >= program.length) return state;
  const next = program.slice();
  next.splice(index, 1);
  return withProgram(state, next);
}

// ---- The open site ---------------------------------------------------------

const withSite = (state: GantryState, site: OpenSite): GantryState => ({
  ...state,
  site,
});

/** Remove every load from the open site. */
export const clearLoads = (state: GantryState): GantryState =>
  withSite(state, { ...state.site, loads: [] });

/**
 * Append a load standing at rest at that pose. Its target pose starts equal to
 * its starting pose (`specs/instrumentation.md`).
 */
export function addLoad(
  state: GantryState,
  cls: LoadClass,
  mass: number,
  pos: Vec3,
  yaw: number,
): GantryState {
  const pose: Pose = { pos, yaw };
  return withSite(state, {
    ...state.site,
    loads: [...state.site.loads, { cls, mass, from: pose, to: copyPose(pose) }],
  });
}

/** Set the pad the load at `index` must be set down on. */
export function setLoadTarget(
  state: GantryState,
  index: number,
  pos: Vec3,
  yaw: number,
): GantryState {
  const loads = state.site.loads.map((l, i) =>
    i === index ? { ...l, to: { pos, yaw } } : l,
  );
  return withSite(state, { ...state.site, loads });
}

/** Remove every obstacle from the open site. */
export const clearObstacles = (state: GantryState): GantryState =>
  withSite(state, { ...state.site, obstacles: [] });

/** Append the axis-aligned box with that minimum corner and that size. */
export function addObstacle(
  state: GantryState,
  min: Vec3,
  size: Vec3,
): GantryState {
  const box: Box = {
    min,
    max: [min[0] + size[0], min[1] + size[1], min[2] + size[2]],
  };
  return withSite(state, {
    ...state.site,
    obstacles: [...state.site.obstacles, box],
  });
}

// ---- The session -----------------------------------------------------------

/**
 * Open a site: sets the site index, keeps that site's stored structure and
 * tape, fills the open site with copies of that site's loads and obstacles,
 * empties the undo history, clears the pending node and the shown check result,
 * returns the camera to its start pose, and returns the run to its idle
 * placeholder (`specs/state.md`). It does not itself change the screen.
 */
export function openSite(state: GantryState, index: number): GantryState {
  const authored = SIM_SITES[index];
  return {
    ...state,
    siteIndex: index,
    site: {
      loads: authored.loads.map(copyLoad),
      obstacles: authored.obstacles.map(copyBox),
    },
    pendingNode: null,
    history: [],
    checkResult: null,
    camera: startCamera(),
    run: idleRun(),
  };
}

/** Show a screen and set nothing else. */
export const setScreen = (state: GantryState, screen: Screen): GantryState => ({
  ...state,
  screen,
});

/** Set the highlighted entry of the menu on the screen showing. */
export const setMenuIndex = (
  state: GantryState,
  index: number,
): GantryState => ({ ...state, menuIndex: index });

/**
 * Move the highlight by one entry, wrapping at both ends. A screen with no menu
 * highlights nothing and leaves the index as it stands (`specs/ui.md`).
 */
export function moveMenu(state: GantryState, delta: number): GantryState {
  const count = menuLength(state);
  if (count === 0) return state;
  const from = highlightedIndex(state);
  const next = (((from + delta) % count) + count) % count;
  return { ...state, menuIndex: next };
}

/** Set whether a site has been cleared this session. */
export const setCleared = (
  state: GantryState,
  index: number,
  cleared: boolean,
): GantryState => ({
  ...state,
  cleared: state.cleared.map((was, i) => (i === index ? cleared : was)),
});

/** Record a score as a site's best, whatever it held. */
export const setBest = (
  state: GantryState,
  index: number,
  score: Score | null,
): GantryState => ({
  ...state,
  best: state.best.map((was, i) => (i === index ? score : was)),
});

/**
 * Whether a score beats the one recorded: the first clear records as it
 * stands, and a later clear replaces it on a lower cost, or an equal cost with
 * a lower time (`specs/ui.md`).
 */
export function beatsBest(best: Score | null, score: Score): boolean {
  if (best === null) return true;
  if (score.cost < best.cost) return true;
  return score.cost === best.cost && score.time < best.time;
}

/** Record a clear's score against a site's best, under the rule above. */
export function recordBest(
  state: GantryState,
  index: number,
  score: Score,
): GantryState {
  if (!beatsBest(state.best[index] ?? null, score)) return state;
  return setBest(state, index, { cost: score.cost, time: score.time });
}

/**
 * The title state: the `title` screen with `menuIndex` `0`, site `0` opened,
 * every site uncleared with no recorded score and an empty structure and tape,
 * the `strut` tool, a resting pointer, an idle run, and `simTime` `0`. It is
 * what the game initializes to and what `reset` restores, `muted` aside
 * (`specs/instrumentation.md`).
 */
export function titleState(): GantryState {
  const base: GantryState = {
    screen: "title",
    menuIndex: 0,
    siteIndex: 0,
    cleared: SIM_SITES.map(() => false),
    best: SIM_SITES.map(() => null),
    sites: SIM_SITES.map(() => ({
      structure: emptySiteStructure(),
      program: [],
    })),
    site: { loads: [], obstacles: [] },
    tool: "strut",
    pendingNode: null,
    history: [],
    checkResult: null,
    camera: startCamera(),
    pointer: {
      x: 0,
      y: 0,
      down: false,
      pressX: 0,
      pressY: 0,
      dragging: false,
      captured: false,
    },
    run: idleRun(),
    muted: false,
    simTime: 0,
  };
  return openSite(base, 0);
}

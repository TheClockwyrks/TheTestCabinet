// What the game does to its own state.
//
// `GantryState` is declared in `src/game.ts`, because that is where
// `specs/state.md` fixes the declaration; this module is the operations over
// it. The engine's state is a live object, so an operation here writes the
// fields it changes in place and returns nothing, and an operation the game's
// own rules refuse writes nothing at all.
//
// Nothing here renders, reads input, or plays a sound. The structure rules and
// the run itself belong to `src/sim`, which is called rather than restated.

import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  HOIST_START,
  RESULTS_ITEMS,
  SITES,
  SITE_COUNT,
  TITLE_ITEMS,
  type LoadClass,
} from "./constants";
import {
  AXES,
  cost as simCost,
  startRun as simStartRun,
  type AxisName,
  type LoadPhase,
  type SimSite,
} from "./sim";
import {
  copyLoad,
  copyObstacle,
  copyPoint,
  simSite,
  simStructure,
  writeRun,
} from "./adapt";
import type {
  Camera,
  GameRun,
  GantryState,
  Score,
  Screen,
  SiteState,
  Step,
  Structure,
  Tool,
  Vec3,
} from "./game";

// ---- The vocabularies the screens and the editor are written against -------

/** The seven screens of `specs/ui.md`, in the order that file lists them. */
export const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "select",
  "build",
  "program",
  "run",
  "results",
];

/** The six build tools of `specs/controls.md`. */
export const TOOLS: readonly Tool[] = [
  "strut",
  "cable",
  "rail",
  "ring",
  "counterweight",
  "delete",
];

/** Whether a string names a screen, for reading a posed value. */
export const isScreen = (name: string): name is Screen =>
  (SCREENS as readonly string[]).includes(name);

/** Whether a string names a build tool. */
export const isTool = (name: string): name is Tool =>
  (TOOLS as readonly string[]).includes(name);

/** The three yard screens, which show the 3D scene and the orbit camera. */
export const isYardScreen = (screen: Screen): boolean =>
  screen === "build" || screen === "program" || screen === "run";

// ---- Small builders --------------------------------------------------------

/** An empty crane, which is what a site nothing has been built on carries. */
export const emptyStructure = (): Structure => ({
  members: [],
  nextMemberId: 0,
  ring: null,
  counterweights: [],
});

/**
 * A structure copied deeply enough that neither copy can be changed through the
 * other, which is what the undo history holds.
 */
export function copyStructure(structure: Structure): Structure {
  return {
    members: structure.members.map((m) => ({
      id: m.id,
      a: copyPoint(m.a),
      b: copyPoint(m.b),
      material: m.material,
    })),
    nextMemberId: structure.nextMemberId,
    ring:
      structure.ring === null
        ? null
        : { corner: copyPoint(structure.ring.corner) },
    counterweights: structure.counterweights.map(copyPoint),
  };
}

/** The open site's loads and obstacles, as `specs/sites.md` authored them. */
export const authoredSite = (index: number): SiteState => ({
  loads: SITES[index].loads.map(copyLoad),
  obstacles: SITES[index].obstacles.map(copyObstacle),
});

// ---- Derived readings ------------------------------------------------------

/** The open site as the simulation reads it. */
export const currentSite = (state: GantryState): SimSite =>
  simSite(state.siteIndex, state.site);

/** The structure authored on the open site. */
export const currentStructure = (state: GantryState): Structure =>
  state.sites[state.siteIndex].structure;

/** The tape authored on the open site. */
export const currentProgram = (state: GantryState): Step[] =>
  state.sites[state.siteIndex].program;

/** The open crane's cost (`specs/structure.md`). */
export const craneCost = (state: GantryState): number =>
  simCost(simStructure(currentStructure(state)));

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
 * How many entries the menu on the screen showing has, and `0` on a screen with
 * no menu — `howto`, `build`, `program`, and `run`.
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
export function setCamera(
  state: GantryState,
  yaw: number,
  pitch: number,
  dist: number,
): void {
  state.camera = poseCamera(yaw, pitch, dist);
}

// ---- The run ---------------------------------------------------------------

/**
 * The idle placeholder `specs/state.md` fixes: what the run carries before a
 * site's first run, and what opening a site, aborting, and a `reset` put back.
 */
export const idleRun = (): GameRun => ({
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
});

/**
 * Start a run on the open site, or refuse it. Answers whether one began.
 *
 * Refused exactly as the `run` action is — a readiness issue or an empty tape —
 * in which case nothing is written and no run begins. A run that begins carries
 * what `specs/state.md` tabulates for a start, at watch speed `0` with an empty
 * accumulator, and the run screen is shown.
 */
export function beginRun(state: GantryState): boolean {
  const started = simStartRun({
    site: currentSite(state),
    structure: simStructure(currentStructure(state)),
    tape: currentProgram(state),
  });
  if (started === null) return false;
  const run = idleRun();
  writeRun(run, started);
  state.run = run;
  state.screen = "run";
  return true;
}

/**
 * Abort a run in progress: it ends with no verdict, the run goes back to its
 * idle placeholder, and the build screen returns (`specs/program.md`). With no
 * run in progress nothing is written.
 */
export function abortRun(state: GantryState): void {
  if (state.run.phase !== "running") return;
  state.run = idleRun();
  state.screen = "build";
}

/** The run's tick count, from which the run clock follows. */
export function setRunTick(state: GantryState, tick: number): void {
  state.run.tick = tick;
}

/** The watch speed, as an index into `RUN_SPEEDS`. */
export function setSpeedIndex(state: GantryState, index: number): void {
  state.run.speedIndex = index;
}

/** Set an axis's value, leaving it stopped with no live command. */
export function setAxis(
  state: GantryState,
  axis: AxisName,
  value: number,
): void {
  state.run.axes[axis] = { value, rate: 0, command: null };
}

/** Set an axis's signed rate, leaving its value and its command as they are. */
export function setAxisRate(
  state: GantryState,
  axis: AxisName,
  rate: number,
): void {
  state.run.axes[axis] = { ...state.run.axes[axis], rate };
}

/** Put the pendulum bob at a world position. */
export function setBob(state: GantryState, pos: Vec3): void {
  state.run.bob = { pos, vel: state.run.bob.vel };
}

/** Set the bob's velocity. */
export function setBobVelocity(state: GantryState, vel: Vec3): void {
  state.run.bob = { pos: state.run.bob.pos, vel };
}

/** Put a load's lift point at a world position, at that yaw. */
export function setLoadPose(
  state: GantryState,
  index: number,
  pos: Vec3,
  yaw: number,
): void {
  const load = state.run.loads[index];
  if (load === undefined) return;
  load.pos = pos;
  load.yaw = yaw;
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
): void {
  const run = state.run;
  const load = run.loads[index];
  if (load === undefined) return;
  if (phase === "attached" && run.attached !== null && run.attached !== index) {
    return;
  }
  const target = state.site.loads[index];
  if (phase === "placed" && target !== undefined) {
    load.pos = { x: target.to.x, y: target.to.y, z: target.to.z };
    load.yaw = target.to.yaw;
  }
  load.phase = phase;
  run.attached =
    phase === "attached" ? index : run.attached === index ? null : run.attached;
}

// ---- The editor's selection ------------------------------------------------

/**
 * Select a build tool, as the tool actions do. A pending node belongs to the
 * placement rather than the tool, so it survives every switch
 * (`specs/controls.md`).
 */
export function setTool(state: GantryState, tool: Tool): void {
  state.tool = tool;
}

/**
 * Hold a lattice node as the pending first node of a member placement, as a
 * first click does.
 */
export function setPendingNode(state: GantryState, node: Vec3): void {
  state.pendingNode = node;
}

/** Clear the pending node without placing, as `back` does. */
export function clearPendingNode(state: GantryState): void {
  state.pendingNode = null;
}

// ---- The tape --------------------------------------------------------------

/** Whether the tape editor accepts a rate on an axis (`specs/program.md`). */
export const acceptableRate = (axis: AxisName, rate: number): boolean =>
  Number.isFinite(rate) && rate > 0 && rate <= AXES[axis].maxRate;

/**
 * Put a tape on the open site. The check result stands only until the structure
 * or the tape changes (`specs/structure.md`), and this is the tape half of that.
 */
export function putProgram(state: GantryState, program: Step[]): void {
  state.sites[state.siteIndex].program = program;
  state.checkResult = null;
}

/** Empty the open site's tape. A tape already empty is left as it stands. */
export function clearProgram(state: GantryState): void {
  if (currentProgram(state).length === 0) return;
  putProgram(state, []);
}

/**
 * Append a move step carrying one command. Refused, silently, when the tape
 * editor would refuse the rate.
 */
export function addMoveStep(
  state: GantryState,
  axis: AxisName,
  target: number,
  rate: number,
): void {
  if (!acceptableRate(axis, rate)) return;
  putProgram(state, [
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
): void {
  const program = currentProgram(state);
  const step = program[index];
  if (step === undefined || step.kind !== "move") return;
  if (!acceptableRate(axis, rate)) return;
  if (step.commands.some((c) => c.axis === axis)) return;
  const next = program.slice();
  next[index] = {
    kind: "move",
    commands: [...step.commands, { axis, target, rate }],
  };
  putProgram(state, next);
}

/** Append an action step. */
export function addActionStep(
  state: GantryState,
  action: "attach" | "release",
): void {
  putProgram(state, [...currentProgram(state), { kind: "action", action }]);
}

/** Remove the step at `index`. An index the tape does not carry removes none. */
export function removeStep(state: GantryState, index: number): void {
  const program = currentProgram(state);
  if (index < 0 || index >= program.length) return;
  const next = program.slice();
  next.splice(index, 1);
  putProgram(state, next);
}

// ---- The open site ---------------------------------------------------------

/** Remove every load from the open site. */
export function clearLoads(state: GantryState): void {
  state.site = { loads: [], obstacles: state.site.obstacles };
}

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
): void {
  const pose = { x: pos.x, y: pos.y, z: pos.z, yaw };
  state.site = {
    loads: [
      ...state.site.loads,
      { class: cls, mass, from: pose, to: { ...pose } },
    ],
    obstacles: state.site.obstacles,
  };
}

/** Set the pad the load at `index` must be set down on. */
export function setLoadTarget(
  state: GantryState,
  index: number,
  pos: Vec3,
  yaw: number,
): void {
  const loads = state.site.loads.map((load, i) =>
    i === index ? { ...load, to: { x: pos.x, y: pos.y, z: pos.z, yaw } } : load,
  );
  state.site = { loads, obstacles: state.site.obstacles };
}

/** Remove every obstacle from the open site. */
export function clearObstacles(state: GantryState): void {
  state.site = { loads: state.site.loads, obstacles: [] };
}

/** Append the axis-aligned box with that minimum corner and that size. */
export function addObstacle(state: GantryState, min: Vec3, size: Vec3): void {
  state.site = {
    loads: state.site.loads,
    obstacles: [
      ...state.site.obstacles,
      { min: { ...min }, size: { ...size } },
    ],
  };
}

// ---- The session -----------------------------------------------------------

/** Show a screen and set nothing else. */
export function setScreen(state: GantryState, screen: Screen): void {
  state.screen = screen;
}

/** Set the highlighted entry of the menu on the screen showing. */
export function setMenuIndex(state: GantryState, index: number): void {
  state.menuIndex = index;
}

/**
 * Move the highlight by one entry, wrapping at both ends. A screen with no menu
 * highlights nothing and leaves the index as it stands (`specs/ui.md`).
 */
export function moveMenu(state: GantryState, delta: number): void {
  const count = menuLength(state);
  if (count === 0) return;
  const from = highlightedIndex(state);
  state.menuIndex = (((from + delta) % count) + count) % count;
}

/** Set whether a site has been cleared this session. */
export function setCleared(
  state: GantryState,
  index: number,
  cleared: boolean,
): void {
  state.cleared[index] = cleared;
}

/** Record a score as a site's best, whatever it held. */
export function setBest(
  state: GantryState,
  index: number,
  score: Score | null,
): void {
  state.best[index] = score;
}

/**
 * Whether a score beats the one recorded: the first clear records as it stands,
 * and a later clear replaces it on a lower cost, or an equal cost with a lower
 * time (`specs/ui.md`).
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
): void {
  if (!beatsBest(state.best[index] ?? null, score)) return;
  setBest(state, index, { cost: score.cost, time: score.time });
}

/**
 * Open a site: sets the site index, keeps that site's stored structure and
 * tape, fills the open site with copies of that site's loads and obstacles,
 * empties the undo history, clears the pending node and the shown check result,
 * returns the camera to its start pose, and returns the run to its idle
 * placeholder (`specs/state.md`). It does not itself change the screen.
 */
export function openSite(state: GantryState, index: number): void {
  state.siteIndex = index;
  state.site = authoredSite(index);
  state.pendingNode = null;
  state.history = [];
  state.checkResult = null;
  state.camera = startCamera();
  state.run = idleRun();
}

/**
 * Return every field to its title-screen value bar `muted`, the game's readable
 * copy of a bit it does not own (`specs/instrumentation.md`).
 */
export function resetState(state: GantryState): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.cleared = Array.from({ length: SITE_COUNT }, () => false);
  state.best = Array.from({ length: SITE_COUNT }, () => null);
  state.sites = Array.from({ length: SITE_COUNT }, () => ({
    structure: emptyStructure(),
    program: [],
  }));
  state.tool = "strut";
  state.pointer = {
    x: 0,
    y: 0,
    down: false,
    pressX: 0,
    pressY: 0,
    dragging: false,
  };
  state.simTime = 0;
  openSite(state, 0);
}

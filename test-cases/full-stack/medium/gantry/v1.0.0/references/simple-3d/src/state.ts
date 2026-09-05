// The pure transitions over Gantry's state, and the facts read off it.
//
// The engine holds the state by value and hands every reader a
// `DeepReadonly<GantryState>`, so every transition here has the shape of
// `update`: the current state in, the next state out. Each one thaws what it
// was given, writes the field it is about, and returns it; the state it was
// handed comes back unchanged, and a transition the game's own rules refuse
// returns a state equal to the one it received.
//
// Nothing here renders, reads input, or plays a sound. A transition that raises
// a cue leaves it on `state.cues` for the update that runs next to play
// (`specs/ui.md`), which is what keeps every one of them pure and poseable.

import type { DeepReadonly } from "@clockwyrks/simple-3d";
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
  type CueName,
  type LoadClass,
} from "./constants";
import {
  authoredSiteState,
  copyPoint,
  emptyStructure,
  fromSimRun,
  idleRun,
  point,
  thaw,
  toSimSite,
  toSimStructure,
  toSimTape,
  type ReadonlyPoint,
} from "./convert";
import type {
  Camera,
  GantryState,
  LoadPhase,
  ReadonlyGantryState,
  Screen,
  Score,
  Step,
  Structure,
  Tool,
} from "./game";
import {
  AXES,
  cost as structureCost,
  startRun as simStartRun,
  type AxisName,
  type SimSite,
  type Structure as SimStructure,
  type Tape,
} from "./sim";

// ---- The vocabularies ------------------------------------------------------

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

// ---- Derived readings ------------------------------------------------------

/** The structure authored on the open site. */
export const currentStructure = (
  state: ReadonlyGantryState,
): DeepReadonly<Structure> => state.sites[state.siteIndex].structure;

/** The tape authored on the open site. */
export const currentProgram = (
  state: ReadonlyGantryState,
): readonly DeepReadonly<Step>[] => state.sites[state.siteIndex].program;

/** The open site as the simulation reads it. */
export const currentSite = (state: ReadonlyGantryState): SimSite =>
  toSimSite(state.siteIndex, state.site);

/** The open structure as the simulation reads it. */
export const currentSimStructure = (state: ReadonlyGantryState): SimStructure =>
  toSimStructure(currentStructure(state));

/** The open tape as the simulation reads it. */
export const currentTape = (state: ReadonlyGantryState): Tape =>
  toSimTape(currentProgram(state));

/** The open crane's cost (`specs/structure.md`). */
export const craneCost = (state: ReadonlyGantryState): number =>
  structureCost(currentSimStructure(state));

/**
 * Whether a site is open to enter: site `0` always, and site `n + 1` once site
 * `n` has been cleared (`specs/ui.md`).
 */
export const siteUnlocked = (
  state: ReadonlyGantryState,
  index: number,
): boolean => index === 0 || state.cleared[index - 1] === true;

/** The results menu, which drops `NEXT SITE` on the last site (`specs/ui.md`). */
export const resultsItems = (siteIndex: number): readonly string[] =>
  siteIndex >= SITE_COUNT - 1 ? RESULTS_ITEMS.slice(1) : RESULTS_ITEMS.slice();

/**
 * How many entries the menu on the screen showing has, and `0` on a screen
 * with no menu — `howto`, `build`, `program`, and `run`.
 */
export function menuLength(state: ReadonlyGantryState): number {
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
export function highlightedIndex(state: ReadonlyGantryState): number {
  const count = menuLength(state);
  if (count === 0) return state.menuIndex;
  return Math.min(Math.max(state.menuIndex, 0), count - 1);
}

// ---- Cues ------------------------------------------------------------------

/**
 * Ask for a cue on a state the caller already owns. The update that runs next
 * plays every cue queued here and empties the queue.
 */
export function raise(
  state: GantryState,
  cue: CueName,
  at: ReadonlyPoint | null = null,
): GantryState {
  state.cues.push({ cue, at: at === null ? null : copyPoint(at) });
  return state;
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
  state: ReadonlyGantryState,
  yaw: number,
  pitch: number,
  dist: number,
): GantryState {
  const s = thaw(state);
  s.camera = poseCamera(yaw, pitch, dist);
  return s;
}

// ---- The session -----------------------------------------------------------

/**
 * Open a site: sets the site index, keeps that site's stored structure and
 * tape, fills the open site with copies of that site's loads and obstacles,
 * empties the undo history, clears the pending node and the shown check result,
 * returns the camera to its start pose, and returns the run to its idle
 * placeholder (`specs/state.md`). It does not itself change the screen.
 */
export function openSite(
  state: ReadonlyGantryState,
  index: number,
): GantryState {
  const s = thaw(state);
  s.siteIndex = index;
  s.site = authoredSiteState(index);
  s.pendingNode = null;
  s.history = [];
  s.checkResult = null;
  s.camera = startCamera();
  s.run = idleRun();
  return s;
}

/** Show a screen and set nothing else. */
export function setScreen(
  state: ReadonlyGantryState,
  screen: Screen,
): GantryState {
  const s = thaw(state);
  s.screen = screen;
  return s;
}

/** Set the highlighted entry of the menu on the screen showing. */
export function setMenuIndex(
  state: ReadonlyGantryState,
  index: number,
): GantryState {
  const s = thaw(state);
  s.menuIndex = index;
  return s;
}

/**
 * Move the highlight by one entry, wrapping at both ends. A screen with no menu
 * highlights nothing and leaves the index as it stands (`specs/ui.md`).
 */
export function moveMenu(
  state: ReadonlyGantryState,
  delta: number,
): GantryState {
  const count = menuLength(state);
  const s = thaw(state);
  if (count === 0) return s;
  const from = highlightedIndex(state);
  s.menuIndex = (((from + delta) % count) + count) % count;
  return s;
}

/** Set whether a site has been cleared this session. */
export function setCleared(
  state: ReadonlyGantryState,
  index: number,
  cleared: boolean,
): GantryState {
  const s = thaw(state);
  s.cleared[index] = cleared;
  return s;
}

/** Record a score as a site's best, whatever it held. */
export function setBest(
  state: ReadonlyGantryState,
  index: number,
  score: Score | null,
): GantryState {
  const s = thaw(state);
  s.best[index] =
    score === null ? null : { cost: score.cost, time: score.time };
  return s;
}

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
  state: ReadonlyGantryState,
  index: number,
  score: Score,
): GantryState {
  const held = state.best[index];
  const best = held === undefined || held === null ? null : { ...held };
  if (!beatsBest(best, score)) return thaw(state);
  return setBest(state, index, score);
}

// ---- The run ---------------------------------------------------------------

/**
 * Start a run on the open site, or refuse it.
 *
 * Refused exactly as the `run` action is — a readiness issue or an empty tape —
 * in which case `null` comes back and no run begins. A run that begins carries
 * what `specs/state.md` tabulates for a start, at watch speed `0` with an empty
 * accumulator, raises `run-start`, and shows the run screen.
 */
export function beginRun(state: ReadonlyGantryState): GantryState | null {
  const started = simStartRun({
    site: currentSite(state),
    structure: currentSimStructure(state),
    tape: currentTape(state),
  });
  if (started === null) return null;
  const s = thaw(state);
  s.screen = "run";
  s.run = fromSimRun(started, 0, 0, null);
  return raise(s, "run-start", s.run.pivot);
}

/**
 * Abort a run in progress: it ends with no verdict, the run goes back to its
 * idle placeholder, and the build screen returns (`specs/program.md`). A state
 * with no run in progress comes back unchanged.
 */
export function abortRun(state: ReadonlyGantryState): GantryState {
  const s = thaw(state);
  if (s.run.phase !== "running") return s;
  s.screen = "build";
  s.run = idleRun();
  return s;
}

/** The watch speed, as an index into `RUN_SPEEDS`. */
export function setSpeedIndex(
  state: ReadonlyGantryState,
  index: number,
): GantryState {
  const s = thaw(state);
  s.run.speedIndex = index;
  return s;
}

/** Set an axis's value, leaving it stopped with no live command. */
export function setAxis(
  state: ReadonlyGantryState,
  axis: AxisName,
  value: number,
): GantryState {
  const s = thaw(state);
  s.run.axes[axis] = { value, rate: 0, command: null };
  return s;
}

/** Set an axis's signed rate, leaving its value and its command as they are. */
export function setAxisRate(
  state: ReadonlyGantryState,
  axis: AxisName,
  rate: number,
): GantryState {
  const s = thaw(state);
  s.run.axes[axis].rate = rate;
  return s;
}

/** Put the pendulum bob at a world position. */
export function setBob(
  state: ReadonlyGantryState,
  at: ReadonlyPoint,
): GantryState {
  const s = thaw(state);
  s.run.bob.pos = copyPoint(at);
  return s;
}

/** Set the bob's velocity. */
export function setBobVelocity(
  state: ReadonlyGantryState,
  vel: ReadonlyPoint,
): GantryState {
  const s = thaw(state);
  s.run.bob.vel = copyPoint(vel);
  return s;
}

/** Put a load's lift point at a world position, at that yaw. */
export function setLoadPose(
  state: ReadonlyGantryState,
  index: number,
  at: ReadonlyPoint,
  yaw: number,
): GantryState {
  const s = thaw(state);
  const load = s.run.loads[index];
  if (load === undefined) return s;
  load.pos = copyPoint(at);
  load.yaw = yaw;
  return s;
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
  state: ReadonlyGantryState,
  index: number,
  phase: LoadPhase,
): GantryState {
  const s = thaw(state);
  if (phase === "attached" && s.run.attached !== null) {
    if (s.run.attached !== index) return s;
  }
  const load = s.run.loads[index];
  if (load === undefined) return s;
  const target = s.site.loads[index];
  load.phase = phase;
  if (phase === "placed" && target !== undefined) {
    load.pos = point(target.to.x, target.to.y, target.to.z);
    load.yaw = target.to.yaw;
  }
  if (phase === "attached") s.run.attached = index;
  else if (s.run.attached === index) s.run.attached = null;
  return s;
}

// ---- The editor's selection ------------------------------------------------

/**
 * Select a build tool, as the tool actions do. A pending node belongs to the
 * placement rather than the tool, so it survives every switch
 * (`specs/controls.md`).
 */
export function setTool(state: ReadonlyGantryState, tool: Tool): GantryState {
  const s = thaw(state);
  s.tool = tool;
  return s;
}

/**
 * Hold a lattice node as the pending first node of a member placement, as a
 * first click does.
 */
export function setPendingNode(
  state: ReadonlyGantryState,
  node: ReadonlyPoint,
): GantryState {
  const s = thaw(state);
  s.pendingNode = copyPoint(node);
  return s;
}

/** Clear the pending node without placing, as `back` does. */
export function clearPendingNode(state: ReadonlyGantryState): GantryState {
  const s = thaw(state);
  s.pendingNode = null;
  return s;
}

// ---- The tape --------------------------------------------------------------

/** Whether the tape editor accepts a rate on an axis (`specs/program.md`). */
export const acceptableRate = (axis: AxisName, rate: number): boolean =>
  Number.isFinite(rate) && rate > 0 && rate <= AXES[axis].maxRate;

/**
 * Put a tape on the open site. The check result stands only until the structure
 * or the tape changes (`specs/structure.md`), and this is the tape half of it.
 */
function withProgram(s: GantryState, program: Step[]): GantryState {
  s.sites[s.siteIndex].program = program;
  s.checkResult = null;
  return s;
}

/** Empty the open site's tape. A tape already empty is left as it stands. */
export function clearProgram(state: ReadonlyGantryState): GantryState {
  const s = thaw(state);
  if (s.sites[s.siteIndex].program.length === 0) return s;
  return withProgram(s, []);
}

/**
 * Append a move step carrying one command. Refused, silently, when the tape
 * editor would refuse the rate.
 */
export function addMoveStep(
  state: ReadonlyGantryState,
  axis: AxisName,
  target: number,
  rate: number,
): GantryState {
  const s = thaw(state);
  if (!acceptableRate(axis, rate)) return s;
  const program = s.sites[s.siteIndex].program;
  return withProgram(s, [
    ...program,
    { kind: "move", commands: [{ axis, target, rate }] },
  ]);
}

/**
 * Add a command to the move step at `index`. Refused, silently, on an action
 * step, on an axis that step already commands, and on a rate the editor
 * refuses.
 */
export function addCommand(
  state: ReadonlyGantryState,
  index: number,
  axis: AxisName,
  target: number,
  rate: number,
): GantryState {
  const s = thaw(state);
  const program = s.sites[s.siteIndex].program;
  const step = program[index];
  if (step === undefined || step.kind !== "move") return s;
  if (!acceptableRate(axis, rate)) return s;
  if (step.commands.some((c) => c.axis === axis)) return s;
  const next = program.slice();
  next[index] = {
    kind: "move",
    commands: [...step.commands, { axis, target, rate }],
  };
  return withProgram(s, next);
}

/** Append an action step. */
export function addActionStep(
  state: ReadonlyGantryState,
  action: "attach" | "release",
): GantryState {
  const s = thaw(state);
  const program = s.sites[s.siteIndex].program;
  return withProgram(s, [...program, { kind: "action", action }]);
}

/** Remove the step at `index`. An index the tape does not carry removes none. */
export function removeStep(
  state: ReadonlyGantryState,
  index: number,
): GantryState {
  const s = thaw(state);
  const program = s.sites[s.siteIndex].program;
  if (index < 0 || index >= program.length) return s;
  const next = program.slice();
  next.splice(index, 1);
  return withProgram(s, next);
}

// ---- The open site ---------------------------------------------------------

/** Remove every load from the open site. */
export function clearLoads(state: ReadonlyGantryState): GantryState {
  const s = thaw(state);
  s.site.loads = [];
  return s;
}

/**
 * Append a load standing at rest at that pose. Its target pose starts equal to
 * its starting pose (`specs/instrumentation.md`).
 */
export function addLoad(
  state: ReadonlyGantryState,
  cls: LoadClass,
  mass: number,
  at: ReadonlyPoint,
  yaw: number,
): GantryState {
  const s = thaw(state);
  const pose = { x: at.x, y: at.y, z: at.z, yaw };
  s.site.loads = [
    ...s.site.loads,
    { class: cls, mass, from: pose, to: { ...pose } },
  ];
  return s;
}

/** Set the pad the load at `index` must be set down on. */
export function setLoadTarget(
  state: ReadonlyGantryState,
  index: number,
  at: ReadonlyPoint,
  yaw: number,
): GantryState {
  const s = thaw(state);
  const load = s.site.loads[index];
  if (load === undefined) return s;
  s.site.loads = s.site.loads.map((entry, i) =>
    i === index ? { ...entry, to: { x: at.x, y: at.y, z: at.z, yaw } } : entry,
  );
  return s;
}

/** Remove every obstacle from the open site. */
export function clearObstacles(state: ReadonlyGantryState): GantryState {
  const s = thaw(state);
  s.site.obstacles = [];
  return s;
}

/** Append the axis-aligned box with that minimum corner and that size. */
export function addObstacle(
  state: ReadonlyGantryState,
  min: ReadonlyPoint,
  size: ReadonlyPoint,
): GantryState {
  const s = thaw(state);
  s.site.obstacles = [
    ...s.site.obstacles,
    { min: copyPoint(min), size: copyPoint(size) },
  ];
  return s;
}

// ---- The title state -------------------------------------------------------

/**
 * The title state: the `title` screen with `menuIndex` `0`, site `0` opened,
 * every site uncleared with no recorded score and an empty structure and tape,
 * the `strut` tool, a resting pointer, an idle run, and `simTime` `0`. It is
 * what `initialize` builds and what `reset` restores, `muted` aside
 * (`specs/instrumentation.md`).
 */
export function titleState(): GantryState {
  const sites: { structure: Structure; program: Step[] }[] = [];
  const cleared: boolean[] = [];
  const best: (Score | null)[] = [];
  for (let i = 0; i < SITE_COUNT; i++) {
    sites.push({ structure: emptyStructure(), program: [] });
    cleared.push(false);
    best.push(null);
  }
  const base: GantryState = {
    screen: "title",
    menuIndex: 0,
    siteIndex: 0,
    cleared,
    best,
    sites,
    site: authoredSiteState(0),
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
    cues: [],
  };
  return openSite(base, 0);
}

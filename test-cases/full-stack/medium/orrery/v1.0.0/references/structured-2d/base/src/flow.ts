// Orrery — the screens, the transitions, and the actions that drive them
// (specs/ui.md, specs/controls.md, specs/state.md, specs/simulation.md).
//
// The state is the world's; these are the ONLY functions that move it from one
// screen to the next, from one challenge to the next, and from editing to a
// run. The player controller (`src/controller.ts`) routes the frame's action
// edges and pointer samples through them, and the debug surface
// (`src/debug.ts`) poses the game through exactly the same ones — so a
// scenario driven from code and a session played by hand run down one path.
//
// Nothing here plays a sound or spawns an effect. Both are ASKED FOR on the
// host and drained by the frame (`src/host.ts`), which is what lets a pose
// sound nothing at the call and still let the edit it committed sound on the
// next frame advanced (specs/instrumentation.md).

import { challengeCount, challengesOf } from "./challenges";
import {
  CUES,
  HOWTO_PAGES,
  SOLVED_ITEMS,
  SPEEDS,
  TITLE_ITEMS,
  type ActionName,
} from "./constants";
import { applyEditorAction, applyPointerSample } from "./editor";
import { DRAG_ACTIONS, type ActionContext } from "./figures";
import { cloneChallenge } from "./formats";
import type { OrreryHost, PointerSample } from "./host";
import { advanceRun, startRun, stepOneCycle, stopRun } from "./sim";
import {
  emptyEditor,
  lastOf,
  resetState,
  setLastOf,
  solvedOf,
  stashMachine,
  stashedMachine,
  type OrreryState,
} from "./state";
import type { Challenge, Mode, Screen } from "./types";

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/**
 * One frame of game time. `simTime` accumulates `dt` whatever the screen, the
 * engine's mute bit is mirrored in, and the run advances while it is
 * `running` (specs/state.md, specs/simulation.md).
 */
export function advanceFrame(host: OrreryHost, dt: number): void {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const state = host.state;
  state.simTime += step;
  state.muted = host.muted();
  if (state.screen === "editor" && state.sim?.status === "running") {
    advanceRun(host, step);
  }
}

// ---------------------------------------------------------------------------
// Screens and transitions
// ---------------------------------------------------------------------------

/** Which set of actions the game answers right now (specs/controls.md). */
export function actionContext(state: OrreryState): ActionContext {
  if (state.screen !== "editor") return state.screen;
  const status = state.sim?.status;
  if (status === undefined) return "editor-editing";
  if (status === "running" || status === "paused") return "editor-running";
  return "editor-halted";
}

/**
 * Enter a screen exactly as the real transition into it enters it
 * (specs/instrumentation.md `setScreen`). Leaving the editor stops a live run,
 * stashes the open challenge's machine, and closes the challenge.
 */
export function enterScreen(host: OrreryHost, name: Screen): void {
  const state = host.state;
  if (name === "editor") {
    if (state.challenge === null) {
      throw new Error("setScreen: no challenge is open");
    }
    state.screen = "editor";
    state.howtoPage = 0;
    return;
  }
  if (state.screen === "editor") leaveEditor(state, true);
  state.screen = name;
  switch (name) {
    case "title":
      state.menuIndex = 0;
      state.howtoPage = 0;
      break;
    case "howto":
      state.howtoPage = 0;
      break;
    case "select":
      state.howtoPage = 0;
      state.selectIndex = lastOf(state, state.mode);
      break;
  }
}

/**
 * Stop the run and close the challenge. Leaving the editor in play stashes the
 * machine (specs/editor.md); the two challenge operations of
 * specs/instrumentation.md leave every per-challenge stash exactly as it
 * stood, so they close it without stashing.
 */
function leaveEditor(state: OrreryState, stash: boolean): void {
  stopRun(state);
  const ref = state.challengeRef;
  if (stash && ref !== null) {
    stashMachine(state, ref.mode, ref.index, state.editor.parts);
  }
  state.challenge = null;
  state.challengeRef = null;
  state.editor = emptyEditor();
}

/** Open one of a mode's shipped challenges in the editor, with an empty machine. */
export function openChallenge(
  host: OrreryHost,
  mode: Mode,
  index: number,
): void {
  const list = challengesOf(mode);
  const challenge = list[index];
  if (challenge === undefined) {
    throw new Error(
      `openChallenge: index ${index} is outside 0 to ${list.length - 1} for ${mode}`,
    );
  }
  openIn(host.state, cloneChallenge(challenge), { mode, index });
}

/** Open a challenge the challenge lists do not hold, from a document. */
export function loadChallenge(host: OrreryHost, challenge: Challenge): void {
  openIn(host.state, challenge, null);
}

/**
 * Open the editor over a challenge with an empty machine, empty histories, no
 * run, and the tray derived from the challenge. Progress is untouched.
 */
function openIn(
  state: OrreryState,
  challenge: Challenge,
  ref: { mode: Mode; index: number } | null,
): void {
  if (state.screen === "editor") leaveEditor(state, false);
  state.challenge = challenge;
  state.challengeRef = ref;
  state.editor = emptyEditor();
  state.sim = null;
  state.screen = "editor";
  state.howtoPage = 0;
}

/**
 * Enter a challenge from its mode's select screen: the stashed machine of this
 * session, or an empty field on the first visit (specs/editor.md).
 */
export function enterFromSelect(
  host: OrreryHost,
  mode: Mode,
  index: number,
): void {
  const list = challengesOf(mode);
  const challenge = list[index];
  if (challenge === undefined) return;
  const state = host.state;
  if (state.screen === "editor") leaveEditor(state, true);
  state.mode = mode;
  state.challenge = cloneChallenge(challenge);
  state.challengeRef = { mode, index };
  state.editor = emptyEditor();
  state.editor.parts = stashedMachine(state, mode, index);
  state.editor.nextId = state.editor.parts.reduce(
    (next, part) => Math.max(next, part.id + 1),
    1,
  );
  state.sim = null;
  state.screen = "editor";
  state.howtoPage = 0;
  setLastOf(state, mode, index);
}

/** Whether a mode's challenge at `index` may be entered from its select row. */
export function enterable(
  state: OrreryState,
  mode: Mode,
  index: number,
): boolean {
  if (index < 0 || index >= challengeCount(mode)) return false;
  if (mode === "extras") return true;
  return (
    index < state.unlockedCount || solvedOf(state, "campaign").includes(index)
  );
}

/** Restore every declared field to its title-screen value. */
export function reset(host: OrreryHost): void {
  resetState(host.state);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Resolve one pointer sample, in the order the samples arrived. The reading is
 * mirrored into `state.pointer` as the sample lands, so a posed press and a
 * player's press are the same event to the game (specs/instrumentation.md).
 */
export function handlePointer(host: OrreryHost, sample: PointerSample): void {
  const state = host.state;
  state.pointer = {
    x: sample.x,
    y: sample.y,
    down: sample.type === "move" ? state.pointer.down : sample.type === "down",
  };
  applyPointerSample(host, sample);
}

/**
 * Resolve one action's press edge against the screen showing it. An action the
 * screen's row omits does nothing (specs/controls.md "What each screen
 * reads").
 */
export function handleAction(host: OrreryHost, action: ActionName): void {
  const state = host.state;
  if (action === "mute") {
    host.toggleMute();
    state.muted = host.muted();
    return;
  }
  switch (actionContext(state)) {
    case "title":
      titleAction(host, action);
      return;
    case "howto":
      howtoAction(host, action);
      return;
    case "select":
      selectAction(host, action);
      return;
    case "editor-editing":
      editingAction(host, action);
      return;
    case "editor-running":
      runningAction(host, action);
      return;
    case "editor-halted":
      haltedAction(host, action);
      return;
  }
}

function titleAction(host: OrreryHost, action: ActionName): void {
  const state = host.state;
  const count = TITLE_ITEMS.length;
  if (action === "up") state.menuIndex = (state.menuIndex + count - 1) % count;
  else if (action === "down") state.menuIndex = (state.menuIndex + 1) % count;
  else if (action === "confirm") {
    const item = TITLE_ITEMS[state.menuIndex];
    if (item === "CAMPAIGN") {
      state.mode = "campaign";
      enterScreen(host, "select");
    } else if (item === "EXTRAS") {
      state.mode = "extras";
      enterScreen(host, "select");
    } else {
      enterScreen(host, "howto");
    }
  }
}

function howtoAction(host: OrreryHost, action: ActionName): void {
  const state = host.state;
  if (action === "left") state.howtoPage = Math.max(0, state.howtoPage - 1);
  else if (action === "right") {
    state.howtoPage = Math.min(HOWTO_PAGES - 1, state.howtoPage + 1);
  } else if (action === "confirm" || action === "back") {
    enterScreen(host, "title");
  }
}

function selectAction(host: OrreryHost, action: ActionName): void {
  const state = host.state;
  const count = challengeCount(state.mode);
  if (count > 0 && action === "up") {
    state.selectIndex = (state.selectIndex + count - 1) % count;
  } else if (count > 0 && action === "down") {
    state.selectIndex = (state.selectIndex + 1) % count;
  } else if (action === "confirm") {
    if (enterable(state, state.mode, state.selectIndex)) {
      enterFromSelect(host, state.mode, state.selectIndex);
    }
  } else if (action === "back") {
    enterScreen(host, "title");
  }
}

function editingAction(host: OrreryHost, action: ActionName): void {
  const state = host.state;
  // While a drag or a lay is live the editor reads the ghost's four verbs and
  // nothing else (specs/editor.md "Dragging").
  if (state.editor.drag !== null && !DRAG_ACTIONS.includes(action)) return;
  if (action === "play") {
    if (machineReady(state)) {
      startRun(host);
      host.cue(CUES.start);
    }
    return;
  }
  if (action === "step") {
    if (machineReady(state)) {
      startRun(host);
      host.cue(CUES.start);
      if (state.sim !== null) state.sim.status = "paused";
    }
    return;
  }
  if (action === "back") {
    enterScreen(host, "select");
    return;
  }
  applyEditorAction(host, action);
}

function runningAction(host: OrreryHost, action: ActionName): void {
  const state = host.state;
  const sim = state.sim;
  if (sim === null) return;
  switch (action) {
    case "play":
      sim.status = sim.status === "running" ? "paused" : "running";
      return;
    case "step":
      stepOneCycle(host);
      return;
    case "speed-up":
      sim.speed = Math.min(SPEEDS.length - 1, sim.speed + 1);
      return;
    case "speed-down":
      sim.speed = Math.max(0, sim.speed - 1);
      return;
    case "back":
      stopRun(state);
      return;
    default:
      return;
  }
}

function haltedAction(host: OrreryHost, action: ActionName): void {
  const state = host.state;
  const sim = state.sim;
  if (sim === null) return;
  if (action === "back") {
    stopRun(state);
    state.menuIndex = 0;
    return;
  }
  if (sim.status !== "complete") return;
  const items = solvedItems(state);
  if (action === "up") {
    state.menuIndex = (state.menuIndex + items.length - 1) % items.length;
  } else if (action === "down") {
    state.menuIndex = (state.menuIndex + 1) % items.length;
  } else if (action === "confirm") {
    takeSolvedItem(host, items[state.menuIndex]);
  }
}

/** The solved panel's menu: `NEXT CHALLENGE` only when a next one exists. */
export function solvedItems(state: OrreryState): string[] {
  const ref = state.challengeRef;
  const hasNext = ref !== null && ref.index + 1 < challengeCount(ref.mode);
  return SOLVED_ITEMS.filter((item) => item !== "NEXT CHALLENGE" || hasNext);
}

function takeSolvedItem(host: OrreryHost, item: string | undefined): void {
  const state = host.state;
  const ref = state.challengeRef;
  if (item === "NEXT CHALLENGE" && ref !== null) {
    enterFromSelect(host, ref.mode, ref.index + 1);
    return;
  }
  if (item === "BACK TO SELECT") {
    enterScreen(host, "select");
    return;
  }
  stopRun(state);
  state.menuIndex = 0;
}

/**
 * Whether the `play` action starts a run: every rise and every set of the open
 * challenge is placed (specs/editor.md "Running the machine").
 */
export function machineReady(state: OrreryState): boolean {
  if (state.challenge === null) return false;
  return missingApertures(state).length === 0;
}

/** Which rises and sets the machine is still missing, for the heading. */
export function missingApertures(state: OrreryState): string[] {
  const challenge = state.challenge;
  if (challenge === null) return [];
  const missing: string[] = [];
  challenge.reagents.forEach((_molecule, index) => {
    const placed = state.editor.parts.some(
      (part) => part.kind === "rise" && part.index === index,
    );
    if (!placed) missing.push(`rise ${index + 1}`);
  });
  challenge.products.forEach((_molecule, index) => {
    const placed = state.editor.parts.some(
      (part) => part.kind === "set" && part.index === index,
    );
    if (!placed) missing.push(`set ${index + 1}`);
  });
  return missing;
}

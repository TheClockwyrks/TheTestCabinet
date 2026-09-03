// The seven screens: what each one does with a key action, and where the
// navigation leads (`specs/ui.md`, `specs/controls.md`), and the program
// screen's tape editor under the pointer.
//
// The player controller hands over exactly one action per call, on its press
// edge, in the order the actions arrived, and one pointer act per sample it
// read. Held actions the camera moves against are the controller's own and
// never reach here, so the four directions and the two zooms do nothing on the
// three yard screens: there they are the orbit, and the orbit runs against the
// frame's delta time rather than a press edge.
//
// The state is live, so each of these writes it in place.

import { RESULTS_ITEMS, RUN_SPEEDS, type ActionName } from "./constants";
import type { GameIo } from "./io";
import {
  abortRun,
  beginRun,
  clearPendingNode,
  currentProgram,
  currentSite,
  currentStructure,
  highlightedIndex,
  menuLength,
  moveMenu,
  openSite,
  resultsItems,
  setMenuIndex,
  setScreen,
  setSpeedIndex,
  setTool,
  siteUnlocked,
} from "./state";
import { showCheck, undo } from "./editor";
import { startIssues, type StartIssue } from "./sim";
import { simStructure } from "./adapt";
import {
  applyTapeWidget,
  hitTapeWidget,
  insidePanel,
  tapeLayout,
} from "./tape";
import type { GantryState, Tool } from "./game";

/** One pointer act, in logical stage units, as the controller read it. */
export interface PointerAct {
  kind: "down" | "move" | "up";
  x: number;
  y: number;
}

/**
 * The issues that would refuse a run from the screen as it stands, in the order
 * `check` reports them: empty exactly when `run` would start one.
 *
 * A refused start leaves the state exactly as it was (`specs/program.md`,
 * `specs/instrumentation.md`), so what the build and program screens show a
 * refusal with is read rather than recorded — this is that reading.
 */
export const pendingStartIssues = (state: GantryState): readonly StartIssue[] =>
  startIssues(
    currentSite(state),
    simStructure(currentStructure(state)),
    currentProgram(state),
  );

// ---- Where the navigation leads --------------------------------------------

/** The title screen, whose menu is highlighted at `0` on arriving. */
function gotoTitle(state: GantryState): void {
  setScreen(state, "title");
  setMenuIndex(state, 0);
}

/**
 * The select screen, whose highlight sits on the site the yard screens last
 * showed (`specs/ui.md`).
 */
function gotoSelect(state: GantryState): void {
  setScreen(state, "select");
  setMenuIndex(state, state.siteIndex);
}

/**
 * Enter a site: the opening `specs/state.md` fixes, then its build screen.
 * These two together are what entering a site from the select screen does.
 */
function enterSite(state: GantryState, index: number): void {
  openSite(state, index);
  setScreen(state, "build");
}

// ---- The menus -------------------------------------------------------------

/**
 * `confirm` takes the highlighted entry of whichever menu the screen shows.
 * The four screens with no menu have nothing to take.
 */
function confirmEntry(state: GantryState): void {
  const index = highlightedIndex(state);
  switch (state.screen) {
    case "title":
      // TITLE_ITEMS: `SITES`, then `HOW TO PLAY`.
      if (index === 0) gotoSelect(state);
      else setScreen(state, "howto");
      return;
    case "select":
      // A locked site does nothing.
      if (siteUnlocked(state, index)) enterSite(state, index);
      return;
    case "results": {
      const entry = resultsItems(state.siteIndex)[index];
      if (entry === RESULTS_ITEMS[0]) enterSite(state, state.siteIndex + 1);
      else if (entry === RESULTS_ITEMS[1]) enterSite(state, state.siteIndex);
      else gotoSelect(state);
      return;
    }
    default:
      return;
  }
}

/**
 * `back`, against the first of the three rows of `specs/controls.md` that
 * applies: a pending node held on the build screen, then a run in progress on
 * the run screen, then the destination `specs/ui.md` gives the screen.
 */
function goBack(state: GantryState): void {
  if (state.screen === "build" && state.pendingNode !== null) {
    clearPendingNode(state);
    return;
  }
  if (state.screen === "run" && state.run.phase === "running") {
    abortRun(state);
    return;
  }
  switch (state.screen) {
    case "title":
      return;
    case "howto":
    case "select":
      gotoTitle(state);
      return;
    case "build":
    case "program":
      gotoSelect(state);
      return;
    case "run":
      // A run that is not in progress leaves its verdict readable
      // (`specs/state.md`); only the screen changes.
      setScreen(state, "build");
      return;
    case "results":
      // `back` does what `SITE SELECT` does.
      gotoSelect(state);
      return;
  }
}

/** The build tool each tool action selects. */
const TOOL_OF: Readonly<Record<string, Tool>> = {
  "tool-strut": "strut",
  "tool-cable": "cable",
  "tool-rail": "rail",
  "tool-ring": "ring",
  "tool-counterweight": "counterweight",
  "tool-delete": "delete",
};

/**
 * Handle one action's press edge on the screen the state is showing.
 *
 * Every action applies where `specs/controls.md`'s table says and does nothing
 * elsewhere, so an action a screen has no use for writes nothing.
 */
export function handleAction(
  state: GantryState,
  action: ActionName,
  io: GameIo,
): void {
  // `mute` toggles all sound from every screen.
  if (action === "mute") {
    io.toggleMute();
    return;
  }

  const tool = TOOL_OF[action];
  if (tool !== undefined) {
    if (state.screen === "build") setTool(state, tool);
    return;
  }

  switch (action) {
    // The menus move by one and wrap at both ends. On a screen with no menu —
    // the three yard screens, where these are the orbit, and `howto` — they
    // move nothing.
    case "up":
      if (menuLength(state) !== 0) moveMenu(state, -1);
      return;
    case "down":
      if (menuLength(state) !== 0) moveMenu(state, 1);
      return;

    // `left` and `right` reach the menu but leave the highlight where it is,
    // and on the yard screens they are the orbit, which the controller runs
    // against the held key rather than the press edge.
    case "left":
    case "right":
    case "zoom-in":
    case "zoom-out":
      return;

    case "confirm":
      confirmEntry(state);
      return;
    case "back":
      goBack(state);
      return;

    case "undo": {
      if (state.screen !== "build") return;
      const outcome = undo(state);
      if (outcome.cue !== null) io.playCue(outcome.cue);
      return;
    }
    case "check":
      if (state.screen === "build") showCheck(state);
      return;

    case "program":
      if (state.screen === "build") setScreen(state, "program");
      return;
    case "build":
      if (state.screen === "program") setScreen(state, "build");
      return;

    case "run": {
      if (state.screen !== "build" && state.screen !== "program") return;
      // A refused start leaves the player where they were, and the state
      // exactly as it was; `pendingStartIssues` is what the screen shows it
      // with (`specs/program.md`, `specs/ui.md`).
      if (!beginRun(state)) return;
      io.playCue("run-start");
      return;
    }

    case "speed": {
      if (state.screen !== "run") return;
      setSpeedIndex(state, (state.run.speedIndex + 1) % RUN_SPEEDS.length);
      return;
    }

    default:
      return;
  }
}

// ---- The tape editor -------------------------------------------------------

/**
 * Deliver one pointer act to the program screen's tape editor.
 *
 * Answers whether a tape widget took the act. A press a widget takes works that
 * widget for the whole of the press: the controller neither orbits the camera
 * on it nor turns its release into a click (`specs/controls.md`).
 *
 * A press on the panel is the panel's: it takes the widget under it, if any,
 * and consumes the whole press either way, so the camera never turns under the
 * editor. Every widget is a whole edit taken on the press, so the moves and the
 * release that follow change nothing — which is what lets the editor keep no
 * state of its own (`src/tape.ts`).
 */
export function handlePointer(
  state: GantryState,
  act: PointerAct,
  _io: GameIo,
): boolean {
  if (state.screen !== "program") return false;
  // Only a press the panel already took reaches here as a move or a release,
  // and the editor has nothing left to do with it.
  if (act.kind !== "down") return true;
  if (!insidePanel(act.x, act.y)) return false;
  const widget = hitTapeWidget(tapeLayout(state), act.x, act.y);
  if (widget !== null) applyTapeWidget(state, widget);
  return true;
}

// The seven screens: what each one does with a key action, and where the
// navigation leads (`specs/ui.md`, `specs/controls.md`).
//
// Everything here is pure: it takes the state and returns the next one. A cue
// an act raises is left on `state.cues` (`src/state.ts`'s `raise`), which the
// update that runs next plays. The frame hands over exactly one action per
// call, on its press edge; held actions the camera moves against are the
// frame's own and never reach here, so the four directions and the two zooms do
// nothing on the three yard screens: there they are the orbit, and the orbit
// runs against the frame's delta time rather than a press edge.

import { RESULTS_ITEMS, RUN_SPEEDS, type ActionName } from "./constants";
import { thaw } from "./convert";
import { showCheck, undo } from "./edits";
import type { GantryState, ReadonlyGantryState, Tool } from "./game";
import {
  abortRun,
  beginRun,
  clearPendingNode,
  currentSimStructure,
  currentSite,
  currentTape,
  highlightedIndex,
  moveMenu,
  openSite,
  resultsItems,
  setScreen,
  setSpeedIndex,
  setTool,
  siteUnlocked,
} from "./state";
import { startIssues, type StartIssue } from "./sim";
import {
  applyTapeWidget,
  hitTapeWidget,
  insidePanel,
  tapeLayout,
} from "./tape";

/** One pointer act, in logical stage units. */
export interface StagePointerEvent {
  kind: "down" | "move" | "up";
  x: number;
  y: number;
}

/** What the tape editor did with a pointer act. */
export interface PointerOutcome {
  state: GantryState;
  /**
   * Whether a tape widget took the act. A press a widget takes works that
   * widget for the whole of the press: the frame neither orbits the camera on
   * it nor turns its release into a click (`specs/controls.md`).
   */
  consumed: boolean;
}

/**
 * The issues that would refuse a run from the screen as it stands, in the order
 * `check` reports them: empty exactly when `run` would start one.
 *
 * A refused start leaves the state exactly as it was (`specs/program.md`,
 * `specs/instrumentation.md`), so what the build and program screens show a
 * refusal with is read rather than recorded — this is that reading.
 */
export const pendingStartIssues = (
  state: ReadonlyGantryState,
): readonly StartIssue[] =>
  startIssues(
    currentSite(state),
    currentSimStructure(state),
    currentTape(state),
  );

// ---- Where the navigation leads --------------------------------------------

/** The title screen, whose menu is highlighted at `0` on arriving. */
function gotoTitle(state: ReadonlyGantryState): GantryState {
  const s = thaw(state);
  s.screen = "title";
  s.menuIndex = 0;
  return s;
}

/**
 * The select screen, whose highlight sits on the site the yard screens last
 * showed (`specs/ui.md`).
 */
function gotoSelect(state: ReadonlyGantryState): GantryState {
  const s = thaw(state);
  s.screen = "select";
  s.menuIndex = s.siteIndex;
  return s;
}

/**
 * Enter a site: the opening `specs/state.md` fixes, then its build screen.
 * These two together are what entering a site from the select screen does.
 */
const enterSite = (state: ReadonlyGantryState, index: number): GantryState =>
  setScreen(openSite(state, index), "build");

// ---- The menus -------------------------------------------------------------

/**
 * `confirm` takes the highlighted entry of whichever menu the screen shows.
 * The four screens with no menu have nothing to take.
 */
function confirmEntry(state: ReadonlyGantryState): GantryState {
  const index = highlightedIndex(state);
  switch (state.screen) {
    case "title":
      // TITLE_ITEMS: `SITES`, then `HOW TO PLAY`.
      return index === 0 ? gotoSelect(state) : setScreen(state, "howto");
    case "select":
      // A locked site does nothing.
      return siteUnlocked(state, index) ? enterSite(state, index) : thaw(state);
    case "results": {
      const entry = resultsItems(state.siteIndex)[index];
      if (entry === RESULTS_ITEMS[0])
        return enterSite(state, state.siteIndex + 1);
      if (entry === RESULTS_ITEMS[1]) return enterSite(state, state.siteIndex);
      return gotoSelect(state);
    }
    default:
      return thaw(state);
  }
}

/**
 * `back`, against the first of the three rows of `specs/controls.md` that
 * applies: a pending node held on the build screen, then a run in progress on
 * the run screen, then the destination `specs/ui.md` gives the screen.
 */
function goBack(state: ReadonlyGantryState): GantryState {
  if (state.screen === "build" && state.pendingNode !== null) {
    return clearPendingNode(state);
  }
  if (state.screen === "run" && state.run.phase === "running") {
    return abortRun(state);
  }
  switch (state.screen) {
    case "title":
      return thaw(state);
    case "howto":
    case "select":
      return gotoTitle(state);
    case "build":
    case "program":
      return gotoSelect(state);
    case "run":
      // A run that is not in progress leaves its verdict readable
      // (`specs/state.md`); only the screen changes.
      return setScreen(state, "build");
    case "results":
      // `back` does what `SITE SELECT` does.
      return gotoSelect(state);
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
 * elsewhere, so an action a screen has no use for returns the state unchanged.
 * `mute` is the one act that reaches beyond the state: it flips `state.muted`,
 * which the update pushes to the engine before mirroring the bit back.
 */
export function handleAction(
  state: ReadonlyGantryState,
  action: ActionName,
): GantryState {
  // `mute` toggles all sound from every screen.
  if (action === "mute") {
    const s = thaw(state);
    s.muted = !s.muted;
    return s;
  }

  const tool = TOOL_OF[action];
  if (tool !== undefined) {
    return state.screen === "build" ? setTool(state, tool) : thaw(state);
  }

  switch (action) {
    // The menus move by one and wrap at both ends. On a screen with no menu —
    // the three yard screens, where these are the orbit, and `howto` — they
    // move nothing.
    case "up":
      return moveMenu(state, -1);
    case "down":
      return moveMenu(state, 1);

    // `left` and `right` reach the menu but leave the highlight where it is,
    // and on the yard screens they are the orbit, which the frame runs against
    // the held key rather than the press edge.
    case "left":
    case "right":
    case "zoom-in":
    case "zoom-out":
      return thaw(state);

    case "confirm":
      return confirmEntry(state);
    case "back":
      return goBack(state);

    case "undo":
      // `undo` raises its own `delete` cue on the state it returns.
      return state.screen === "build" ? undo(state).state : thaw(state);
    case "check":
      return state.screen === "build" ? showCheck(state) : thaw(state);

    case "program":
      return state.screen === "build"
        ? setScreen(state, "program")
        : thaw(state);
    case "build":
      return state.screen === "program"
        ? setScreen(state, "build")
        : thaw(state);

    case "run": {
      if (state.screen !== "build" && state.screen !== "program") {
        return thaw(state);
      }
      // A refused start leaves the player where they were, and the state
      // exactly as it was; `pendingStartIssues` is what the screen shows it
      // with (`specs/program.md`, `specs/ui.md`). A start that lands raises
      // `run-start` itself.
      return beginRun(state) ?? thaw(state);
    }

    case "speed": {
      if (state.screen !== "run") return thaw(state);
      return setSpeedIndex(
        state,
        (state.run.speedIndex + 1) % RUN_SPEEDS.length,
      );
    }

    default:
      return thaw(state);
  }
}

// ---- The tape editor --------------------------------------------------------

/**
 * Deliver a pointer act to the program screen's tape editor.
 *
 * A press on the panel is the panel's: it takes the widget under it, if any,
 * and consumes the whole press either way, so the camera never turns under the
 * editor. Every widget is a whole edit taken on the press, so the moves and the
 * release that follow change nothing — which is what lets the editor keep no
 * state of its own (`src/tape.ts`).
 */
export function handlePointer(
  state: GantryState,
  event: StagePointerEvent,
): PointerOutcome {
  if (state.screen !== "program") return { state, consumed: false };
  if (event.kind !== "down") {
    // Only a press the panel took reaches here as a move or a release, and the
    // editor has nothing left to do with it.
    return { state, consumed: state.pointer.captured };
  }
  if (!insidePanel(event.x, event.y)) return { state, consumed: false };
  const widget = hitTapeWidget(tapeLayout(state), event.x, event.y);
  if (widget === null) return { state, consumed: true };
  return { state: applyTapeWidget(state, widget), consumed: true };
}

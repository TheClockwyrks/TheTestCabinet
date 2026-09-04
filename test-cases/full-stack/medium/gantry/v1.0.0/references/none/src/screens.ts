// The seven screens: what each one does with a key action, and where the
// navigation leads. `specs/ui.md` fixes the screens and their menus,
// `specs/controls.md` the actions and where `back` leads.
//
// Everything here is pure but for the cues it asks for through `ScreenIo`: it
// takes the state and returns the next one. The frame loop hands over exactly
// one action per call, on its press edge, in the order the actions arrived.
// Held actions the camera moves against are the loop's own and never reach
// here, so the four directions and the two zooms do nothing on the three yard
// screens: there they are the orbit, and the orbit runs against the frame's
// delta time rather than a press edge.

import {
  RESULTS_ITEMS,
  RUN_SPEEDS,
  type ActionName,
  type CueName,
} from "./constants";
import { showCheck, undo } from "./editor";
import { menuHit } from "./menus";
import { startIssues, type StartIssue } from "./sim";
import type { StagePointerEvent } from "./runtime";
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
  setScreen,
  setSpeedIndex,
  setTool,
  siteUnlocked,
  type GantryState,
  type Tool,
} from "./state";
import {
  applyTapeWidget,
  hitTapeWidget,
  insidePanel,
  tapeLayout,
} from "./screens-tape";

/**
 * What a screen asks of the world outside the state: the sounds an act raises
 * and the mute bit the state only mirrors. `src/app.ts` implements it over the
 * runtime layer.
 */
export interface ScreenIo {
  /** Play a one-shot cue (`specs/ui.md`). */
  playCue(cue: CueName): void;
  /** Toggle all sound, which the next update mirrors into `state.muted`. */
  toggleMute(): void;
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
    currentStructure(state),
    currentProgram(state),
  );

// ---- Where the navigation leads --------------------------------------------

/** The title screen, whose menu is highlighted at `0` on arriving. */
const gotoTitle = (state: GantryState): GantryState => ({
  ...state,
  screen: "title",
  menuIndex: 0,
});

/**
 * The select screen, whose highlight sits on the site the yard screens last
 * showed (`specs/ui.md`).
 */
const gotoSelect = (state: GantryState): GantryState => ({
  ...state,
  screen: "select",
  menuIndex: state.siteIndex,
});

/**
 * Enter a site: the opening `specs/state.md` fixes, then its build screen.
 * These two together are what entering a site from the select screen does.
 */
const enterSite = (state: GantryState, index: number): GantryState =>
  setScreen(openSite(state, index), "build");

// ---- The menus -------------------------------------------------------------

/**
 * `confirm` takes the highlighted entry of whichever menu the screen shows.
 * The four screens with no menu have nothing to take.
 */
function confirmEntry(state: GantryState): GantryState {
  const index = highlightedIndex(state);
  switch (state.screen) {
    case "title":
      // TITLE_ITEMS: `SITES`, then `HOW TO PLAY`.
      return index === 0 ? gotoSelect(state) : setScreen(state, "howto");
    case "select":
      // A locked site does nothing.
      return siteUnlocked(state, index) ? enterSite(state, index) : state;
    case "results": {
      const entry = resultsItems(state.siteIndex)[index];
      if (entry === RESULTS_ITEMS[0])
        return enterSite(state, state.siteIndex + 1);
      if (entry === RESULTS_ITEMS[1]) return enterSite(state, state.siteIndex);
      return gotoSelect(state);
    }
    default:
      return state;
  }
}

/**
 * `back`, against the first of the three rows of `specs/controls.md` that
 * applies: a pending node held on the build screen, then a run in progress on
 * the run screen, then the destination `specs/ui.md` gives the screen.
 */
function goBack(state: GantryState): GantryState {
  if (state.screen === "build" && state.pendingNode !== null) {
    return clearPendingNode(state);
  }
  if (state.screen === "run" && state.run.phase === "running") {
    return abortRun(state);
  }
  switch (state.screen) {
    case "title":
      return state;
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
 */
export function handleAction(
  state: GantryState,
  action: ActionName,
  io: ScreenIo,
): GantryState {
  // `mute` toggles all sound from every screen.
  if (action === "mute") {
    io.toggleMute();
    return state;
  }

  const tool = TOOL_OF[action];
  if (tool !== undefined) {
    return state.screen === "build" ? setTool(state, tool) : state;
  }

  switch (action) {
    // The menus move by one and wrap at both ends. On a screen with no menu —
    // the three yard screens, where these are the orbit, and `howto` — they
    // move nothing.
    case "up":
      return menuLength(state) === 0 ? state : moveMenu(state, -1);
    case "down":
      return menuLength(state) === 0 ? state : moveMenu(state, 1);

    // `left` and `right` reach the menu but leave the highlight where it is,
    // and on the yard screens they are the orbit, which the frame loop runs
    // against the held key rather than the press edge.
    case "left":
    case "right":
    case "zoom-in":
    case "zoom-out":
      return state;

    case "confirm":
      return confirmEntry(state);
    case "back":
      return goBack(state);

    case "undo": {
      if (state.screen !== "build") return state;
      const outcome = undo(state);
      if (outcome.cue !== null) io.playCue(outcome.cue);
      return outcome.state;
    }
    case "check":
      return state.screen === "build" ? showCheck(state) : state;

    case "program":
      return state.screen === "build" ? setScreen(state, "program") : state;
    case "build":
      return state.screen === "program" ? setScreen(state, "build") : state;

    case "run": {
      if (state.screen !== "build" && state.screen !== "program") return state;
      // A refused start leaves the player where they were, and the state
      // exactly as it was; `pendingStartIssues` is what the screen shows it
      // with (`specs/program.md`, `specs/ui.md`).
      const started = beginRun(state);
      if (started === null) return state;
      io.playCue("run-start");
      return started;
    }

    case "speed": {
      if (state.screen !== "run") return state;
      const next = (state.run.speedIndex + 1) % RUN_SPEEDS.length;
      return setSpeedIndex(state, next);
    }

    default:
      return state;
  }
}

// ---- The tape editor --------------------------------------------------------

/** What the tape editor did with a pointer act. */
export interface PointerOutcome {
  state: GantryState;
  /**
   * Whether a tape widget took the act. A press a widget takes works that
   * widget for the whole of the press: the frame loop neither orbits the
   * camera on it nor turns its release into a click (`specs/controls.md`).
   */
  consumed: boolean;
}

/**
 * Deliver a pointer act to the program screen's tape editor.
 *
 * A press on the panel is the panel's: it takes the widget under it, if any,
 * and consumes the whole press either way, so the camera never turns under the
 * editor. Every widget is a whole edit taken on the press, so the moves and the
 * release that follow change nothing — which is what lets the editor keep no
 * state of its own (`src/screens-tape.ts`).
 */
export function handlePointer(
  state: GantryState,
  event: StagePointerEvent,
  _io: ScreenIo,
): PointerOutcome {
  if (menuLength(state) > 0) return handleMenuPointer(state, event);
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

// ---- The menus, under a pointer and under a finger --------------------------

/**
 * Deliver a pointer act or a contact edge to the menu the screen is showing
 * (`specs/ui.md`).
 *
 * The pointer moved onto an entry's hit region selects that entry, whether or
 * not a press is live, and a press and its release both inside one region take
 * it. A release outside the region its press went down in takes nothing, which
 * is what lets a player slide off an entry to change their mind. A contact has
 * no hover, so its landing both selects and — with the lift in the same region
 * — takes.
 *
 * Every act on a menu screen is consumed: there is no camera to turn and
 * nothing to edit behind a menu, so a press that hit no entry is still the
 * menu's.
 */
function handleMenuPointer(
  state: GantryState,
  event: StagePointerEvent,
): PointerOutcome {
  const at = menuHit(state, event.x, event.y);

  // A move, a press, and a contact landing all select what they are over and
  // take nothing.
  if (event.kind !== "up" && event.kind !== "touch-up") {
    return {
      state: at === null ? state : { ...state, menuIndex: at },
      consumed: true,
    };
  }

  // A release, or a contact lifting. Both edges fall inside one region or
  // nothing is taken.
  const from =
    event.kind === "up"
      ? menuHit(state, state.pointer.pressX, state.pointer.pressY)
      : at;
  if (at === null || from !== at) return { state, consumed: true };
  const selected: GantryState = { ...state, menuIndex: at };
  return { state: confirmEntry(selected), consumed: true };
}

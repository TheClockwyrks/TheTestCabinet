// Fathom — the game: the state contract, the controls, the frame, and the
// binding of the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once, when the engine is initialized; it
// loads the seeded art, registers the actions, the cues and the diagnostic
// sources, and returns the opening state beside the surface, as `[state, debug]`.
// `update` and `render` then run once each per frame — `update` first, with the
// frame's delta time in SECONDS, then `render`.
//
// The state is the only channel between them, and it is a VALUE: `update` is
// handed the current state as a `DeepReadonly` view and returns the next one, the
// engine stores what it returned, and `render` draws that. No function in this
// build writes to a state it was handed; every one of them is a transition,
// current state in and next state out, built by spreading what it keeps around
// what it changes.
//
// THE STATE SHAPE IS A CONTRACT, and it is declared in `src/state.ts` and
// re-exported here, because `specs/state.md` fixes the state and
// `specs/instrumentation.md` fixes the surface that poses and reads it. So:
//
//   * Every field is declared once, under its declared name, with its declared
//     type and meaning.
//   * `initialize` builds the whole state in one go, which is why no field is
//     optional: by the time any frame can observe the state, every field is
//     present.
//   * Nothing authoritative lives anywhere else. There is no module-level game
//     state in this build and no closure over mutable data — every module beside
//     the state is arithmetic over it — so `reset` restoring the declared fields
//     is enough to make a scenario replay identically.
//
// The fixed timestep is `src/simulate.ts`'s. `dt` is real elapsed seconds, the
// simulation advances the whole `TICK_DT` ticks that delta completes, and the
// remainder is carried into the next frame, so the same interval of game time
// reaches the same state however it was divided into frames
// (`specs/movement.md`).

import {
  CUES,
  DEFAULT_SEED,
  GAMEOVER_ITEMS,
  INK_COOLDOWN,
  PAUSE_ITEMS,
  SONAR_COOLDOWN,
  TITLE_ITEMS,
  type CueName,
} from "./constants";
import { loadSheets } from "./assets";
import { defineCues } from "./audio";
import { createDebugApi, type FathomDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { bodyTile } from "./entities";
import { beginDive, enterScreen, openingState, toTitle } from "./flow";
import {
  backPressed,
  confirmPressed,
  desiredDirection,
  heldDirections,
  inkPressed,
  menuDown,
  menuUp,
  mutePressed,
  pausePressed,
  pointerSamples,
  registerActions,
  sonarPressed,
} from "./input";
import { releaseInk } from "./ink";
import { itemAt } from "./menu";
import { renderGame } from "./render";
import { advanceFrame } from "./simulate";
import { castPulse, sonarRange } from "./sonar";
import { COLOR } from "./theme";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import type { FathomState } from "./state";

// The state contract and the surface are part of this module's contract, so both
// are exported from here whichever module declares them.
export type {
  Dir,
  DrifterState,
  FathomState,
  ForagerState,
  Heading,
  InkCloudState,
  MazeState,
  PredatorMode,
  PredatorState,
  PulseSource,
  PulseState,
  PulseTint,
  Screen,
  Tile,
} from "./state";
export type { FathomDebugApi } from "./debug";
export type { FathomSnapshot, PredatorSnapshot } from "./snapshot";

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the water itself.
 */
export const BACKGROUND: string = COLOR.bg;

/** What this frame's controls left behind. */
interface InputResult {
  readonly state: FathomState;
  readonly cues: readonly CueName[];
}

// ---- The controls --------------------------------------------------------

/**
 * The menu each screen carries, or `null` on a screen with none.
 *
 * `"howto"` is a screen a player leaves rather than a menu, and the three that
 * show the maze read the controls of play instead.
 */
function menuFor(screen: FathomState["screen"]): readonly string[] | null {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameover":
      return GAMEOVER_ITEMS;
    default:
      return null;
  }
}

/** What the pointer and the finger left a menu holding this frame. */
interface PointedMenu {
  /** The state with the selection the gesture made, and its press remembered. */
  readonly state: FathomState;
  /** The item a gesture confirmed, or `null` where none did. */
  readonly confirmed: number | null;
}

/**
 * The pointer and the finger over the current menu (`specs/ui.md`).
 *
 * A sample that lands on an item selects it, which is what makes a mouse move
 * select and a contact select on its landing, since a finger never hovers. A
 * confirm takes both of its edges inside ONE item's region, so the release
 * confirms only where it lands on the item the press landed on: two edges in
 * different regions, and an edge outside every region, confirm nothing.
 */
function menuPointer(
  state: FathomState,
  api: UpdateApi,
  items: readonly string[],
): PointedMenu {
  let next = state;
  let confirmed: number | null = null;
  for (const sample of pointerSamples(api)) {
    const over = itemAt(state.screen, sample.x, sample.y);
    if (over !== null && over < items.length) {
      next = { ...next, menuIndex: over };
    }
    if (sample.type === "down") {
      next = { ...next, pressedItem: over };
      continue;
    }
    if (sample.type !== "up") continue;
    if (over !== null && over === next.pressedItem) confirmed = over;
    next = { ...next, pressedItem: null };
  }
  return { state: next, confirmed };
}

/** What a press on a screen with no item regions is remembered as. */
const SCREEN_PRESS = 0;

/** What a gesture on a screen with no menu left behind this frame. */
interface ScreenGesture {
  /** The state with the press it made remembered. */
  readonly state: FathomState;
  /** Whether a press and its release both landed on the screen. */
  readonly tapped: boolean;
}

/**
 * A gesture completed on a screen that shows no menu: a pointer pressed and
 * released on it, or a contact landed and lifted on it (`specs/ui.md`).
 *
 * The screen carries no item regions, so the press is remembered as
 * `SCREEN_PRESS` rather than as an item, and the release completes the gesture
 * wherever on the screen it lands.
 */
function screenGesture(state: FathomState, api: UpdateApi): ScreenGesture {
  let next = state;
  let tapped = false;
  for (const sample of pointerSamples(api)) {
    if (sample.type === "down") {
      next = { ...next, pressedItem: SCREEN_PRESS };
      continue;
    }
    if (sample.type !== "up") continue;
    if (next.pressedItem === SCREEN_PRESS) tapped = true;
    next = { ...next, pressedItem: null };
  }
  return { state: next, tapped };
}

/**
 * A menu's `up`, `down` and `confirm`, read as edges.
 *
 * All three are read before any is acted on, so exactly one press moves the
 * selection or accepts it and nothing is left armed for a later frame.
 */
function menuInput(
  state: FathomState,
  api: UpdateApi,
  items: readonly string[],
  accept: (state: FathomState, index: number) => FathomState,
): FathomState {
  const up = menuUp(api);
  const down = menuDown(api);
  const confirmed = confirmPressed(api);
  const count = items.length;
  if (up) {
    return { ...state, menuIndex: (state.menuIndex + count - 1) % count };
  }
  if (down) return { ...state, menuIndex: (state.menuIndex + 1) % count };
  if (confirmed) return accept(state, state.menuIndex);
  return state;
}

function acceptTitle(state: FathomState, index: number): FathomState {
  // Confirming an entry here records it, from the keyboard, a pointer and a
  // contact alike, and every later arrival at the title lands on it
  // (`specs/ui.md`).
  const remembered: FathomState = { ...state, titleIndex: index };
  return index === 0 ? beginDive(remembered) : enterScreen(remembered, "howto");
}

function acceptPause(state: FathomState, index: number): FathomState {
  if (index === 0) return enterScreen(state, "playing");
  if (index === 1) return beginDive(state);
  return toTitle(state);
}

function acceptGameOver(state: FathomState, index: number): FathomState {
  return index === 0 ? beginDive(state) : toTitle(state);
}

/** The forager's sonar pulse, when its cooldown is spent (`specs/sensing.md`). */
function emitPulse(state: FathomState): InputResult {
  if (state.sonarCooldown > 0) return { state, cues: [] };
  const at = bodyTile(state.forager);
  const pulse = castPulse(
    state.maze,
    at.tx,
    at.ty,
    sonarRange(state.depth),
    "forager",
    "cyan",
    null,
  );
  return {
    state: {
      ...state,
      sonarCooldown: SONAR_COOLDOWN,
      pulses: [...state.pulses, pulse],
    },
    cues: [CUES.sonar],
  };
}

/** The forager's ink cloud, when its cooldown is spent (`specs/sensing.md`). */
function releaseCloud(state: FathomState): InputResult {
  if (state.inkCooldown > 0) return { state, cues: [] };
  return {
    state: {
      ...state,
      inkCooldown: INK_COOLDOWN,
      inkClouds: [
        ...state.inkClouds,
        releaseInk(state.forager.x, state.forager.y),
      ],
    },
    cues: [CUES.ink],
  };
}

/** Live play's own controls: the two abilities and the pause. */
function playInput(state: FathomState, api: UpdateApi): InputResult {
  // Both abilities are read before either is acted on, so neither edge is left
  // armed for a later frame.
  const sonar = sonarPressed(api);
  const ink = inkPressed(api);
  const paused = pausePressed(api);
  if (paused)
    return {
      state: enterScreen({ ...state, menuIndex: 0 }, "paused"),
      cues: [],
    };

  const cues: CueName[] = [];
  let next = state;
  if (sonar) {
    const fired = emitPulse(next);
    next = fired.state;
    cues.push(...fired.cues);
  }
  if (ink) {
    const released = releaseCloud(next);
    next = released.state;
    cues.push(...released.cues);
  }
  return { state: next, cues };
}

/**
 * This frame's controls (`specs/movement.md`).
 *
 * Each screen reads the actions in its own row and leaves the rest alone, which
 * is what lets `Space` fire the pulse in play and accept a menu item on a menu,
 * and `Escape` pause live play and leave a menu. `mute` is read on every screen.
 * The movement actions are read as held values, which never consumes an edge, so
 * they are read once here whatever the screen and only live play acts on them.
 */
function handleInput(
  state: DeepReadonly<FathomState>,
  api: UpdateApi,
): InputResult {
  if (mutePressed(api)) api.audio.setMuted(!api.audio.muted());

  const held = heldDirections(api);
  const moved: FathomState = {
    ...state,
    heldDirs: held,
    forager: {
      ...state.forager,
      desired: desiredDirection(state.forager.desired, state.heldDirs, held),
    },
  };

  switch (moved.screen) {
    case "playing":
      return playInput(moved, api);
    case "howto": {
      // The two controls that leave, and — because the screen shows no menu — a
      // gesture completed anywhere on it (`specs/ui.md`). All three are read
      // before any is acted on, so none is left armed for a later frame.
      const accepted = confirmPressed(api);
      const left = backPressed(api);
      const gestured = screenGesture(moved, api);
      return {
        state:
          accepted || left || gestured.tapped ? toTitle(moved) : gestured.state,
        cues: [],
      };
    }
    case "paused":
    case "gameover":
    case "title": {
      const items = menuFor(moved.screen);
      if (items === null) return { state: moved, cues: [] };
      // The paused screen reads `pause` and `back` BEFORE the menu's own edges,
      // and a frame carrying either resumes once and does nothing else
      // (`specs/ui.md`). Both are read so neither is left armed for the frame
      // after: `Escape` raises the two of them together.
      if (moved.screen === "paused") {
        const back = backPressed(api);
        const paused = pausePressed(api);
        if (back || paused) {
          return { state: enterScreen(moved, "playing"), cues: [] };
        }
      }
      // On the game-over screen `Escape` means "leave", to the title. The title
      // menu has nowhere to go back to, so `back` there changes nothing.
      if (moved.screen === "gameover" && backPressed(api)) {
        return { state: toTitle(moved), cues: [] };
      }
      const accept =
        moved.screen === "title"
          ? acceptTitle
          : moved.screen === "paused"
            ? acceptPause
            : acceptGameOver;
      // The pointer is read first, because a gesture selects the item it is over
      // before it confirms one and the confirm it raises acts on that selection.
      const pointed = menuPointer(moved, api, items);
      if (pointed.confirmed !== null) {
        return { state: accept(pointed.state, pointed.confirmed), cues: [] };
      }
      return { state: menuInput(pointed.state, api, items, accept), cues: [] };
    }
    case "countdown":
    case "cleared":
      return { state: moved, cues: [] };
  }
}

// ---- The game the engine drives -----------------------------------------

export const game: Game<FathomState, FathomDebugApi> = {
  /**
   * Runs once, before any frame: register the ten actions against their
   * bindings, define the seven cues, register the diagnostic sources, load every
   * frame of the seeded art, and build the complete opening state.
   *
   * Neither the diagnostics nor the surface holds the state: a source is handed
   * the state current at the read, and every operation on the surface takes the
   * state it poses and returns the next one. The surface is returned beside the
   * state because the pair is what the engine holds, so by the time this resolves
   * `engine.debug` carries it (`specs/instrumentation.md`).
   */
  async initialize(
    api: InitApi<FathomState>,
  ): Promise<[FathomState, FathomDebugApi]> {
    registerActions(api);
    defineCues(api);
    registerDiagnostics(api);
    const sheets = await loadSheets(api.assets);
    // A session opens with sound on, and every frame mirrors the engine's bit
    // back into the state from there (`specs/progression.md`).
    return [openingState(sheets, DEFAULT_SEED, false), createDebugApi()];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * The order matters. Edges are news for exactly one frame — the engine discards
   * whatever was not consumed — so they are read first, at the top of the frame
   * they belong to, and the state they may have changed is the state the frame's
   * ticks then advance.
   */
  update(
    state: DeepReadonly<FathomState>,
    api: UpdateApi,
    dt: number,
  ): FathomState {
    const controlled = handleInput(state, api);
    const advanced = advanceFrame(controlled.state, dt);
    // A cue is played on the tick its event happens, and at most once on that
    // tick (`specs/progression.md`).
    for (const cue of controlled.cues) api.audio.play(cue);
    for (const cue of advanced.cues) api.audio.play(cue);
    // The engine owns the mute bit; this is the game's readable copy of it, so
    // the snapshot cannot drift from what the player actually hears.
    return { ...advanced.state, muted: api.audio.muted() };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: DeepReadonly<FathomState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};

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
import { beginDive, openingState, toTitle } from "./flow";
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
  registerActions,
  sonarPressed,
} from "./input";
import { releaseInk } from "./ink";
import { renderGame } from "./render";
import { advanceFrame } from "./simulate";
import { castPulse, sonarRange } from "./sonar";
import { COLOR } from "./theme";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
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
  return index === 0
    ? beginDive(state)
    : { ...state, screen: "howto", menuIndex: 0 };
}

function acceptPause(state: FathomState, index: number): FathomState {
  if (index === 0) return { ...state, screen: "playing" };
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
    return { state: { ...state, screen: "paused", menuIndex: 0 }, cues: [] };

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
      // Both leave, so both are read and neither is left armed.
      const accepted = confirmPressed(api);
      const left = backPressed(api);
      return {
        state: accepted || left ? toTitle(moved) : moved,
        cues: [],
      };
    }
    case "paused":
    case "gameover":
    case "title": {
      const items = menuFor(moved.screen);
      if (items === null) return { state: moved, cues: [] };
      // On a menu `Escape` means "leave": resume from the pause menu, and the
      // title from the game-over menu. The title menu has nowhere to go back to.
      const back = backPressed(api);
      if (back && moved.screen === "paused") {
        return { state: { ...moved, screen: "playing" }, cues: [] };
      }
      if (back && moved.screen === "gameover") {
        return { state: toTitle(moved), cues: [] };
      }
      const accept =
        moved.screen === "title"
          ? acceptTitle
          : moved.screen === "paused"
            ? acceptPause
            : acceptGameOver;
      return { state: menuInput(moved, api, items, accept), cues: [] };
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

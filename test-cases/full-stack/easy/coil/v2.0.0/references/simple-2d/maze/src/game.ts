// Coil — the game: the state contract, the per-frame update, and the binding of
// the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once and returns the state and the
// surface together as `[state, debug]`. `update` and `render` then run once each
// per frame — `update` first, with the frame's delta time in SECONDS, then
// `render`. The state is the only channel between them, and it is a VALUE: the
// engine hands `update` the current state as a `DeepReadonly` view and stores what
// it returns, and `render` draws that. Nothing in this build writes to a state it
// was handed; every function over the state is a transition, current state in and
// next state out, built by spreading what it keeps around what it changes.
//
// THE STATE SHAPE BELOW IS A CONTRACT. It is what the debug surface in
// `src/debug.ts` poses and reads, and `specs/instrumentation.md` fixes the
// snapshot taken off it. Every field is declared here under its name, type and
// meaning; `initialize` builds the whole state in one go, so no field is optional;
// and `reset` on the surface restores exactly these fields. Every field is
// `readonly` and every array is a `readonly` array, so the declared type and the
// `DeepReadonly` view the engine hands out are the same shape and a transition
// spreads one state into the next without a cast.
//
// The screens are wrapped around the round the same way: this file owns the tick
// accumulator, so `update` consumes elapsed game time into whole ticks and carries
// the remainder, and a second of game time is eight ticks whether it arrived in
// one update or in sixty. Drawing advances nothing.

import { loadSprites, type SnakeSprites } from "./assets";
import { defineCues, playTickEvents } from "./audio";
import { createDebugApi, type CoilDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { pressedActions, registerActions } from "./input";
import { menuItemAt, menuItems } from "./menus";
import { renderGame } from "./render";
import { layChain, requestTurn, spawnPellet, tick } from "./sim";
import { COLORS } from "./theme";
import {
  BITE_SECONDS,
  CUES,
  OBSTACLE_CELLS,
  TICK_SECONDS,
  type ActionName,
  type Cell,
  type Direction,
  type Screen,
} from "./constants";
import type {
  Game,
  InitApi,
  PointerSample,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { CoilDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the board's surround.
 */
export const BACKGROUND: string = COLORS.stage;

// ---- The state contract --------------------------------------------------

export interface CoilState {
  /** The screen the game is on; a build opens on `title`. */
  readonly screen: Screen;
  /** The highlighted item of the current screen's menu, counted from 0. */
  readonly menuIndex: number;
  /** The title menu's remembered selection, which the title opens on. */
  readonly titleIndex: number;
  /**
   * The item a live pointer press landed on, or `null` while none is down.
   *
   * `specs/ui.md` takes both edges of a confirm inside one region, so the press
   * has to be remembered until the release that answers it.
   */
  readonly pressedItem: number | null;

  /** The running score of the current round. */
  readonly score: number;
  /** The highest score reached in this session. */
  readonly best: number;
  /** The combo multiplier M, in `[1, COMBO_MAX]`. */
  readonly combo: number;
  /** Seconds of simulation time left on the combo window; `0` is closed. */
  readonly comboWindow: number;

  /** The engine's mute bit, mirrored into the state every frame. */
  readonly muted: boolean;
  /** Ticks resolved since the last reset. */
  readonly ticks: number;
  /** Simulation time accumulated on the playing screen since the last reset. */
  readonly simTime: number;

  /** The direction the head advances in on the next tick. */
  readonly dir: Direction;
  /** The steering requests waiting on the buffer, oldest first. */
  readonly turns: readonly Direction[];
  /** The chain, head at index 0 and tail at the last index. */
  readonly snake: readonly Cell[];
  /** The live pellet, or `null` while no pellet is on the board. */
  readonly pellet: Cell | null;
  /** The obstacle cells currently on the board. */
  readonly obstacles: readonly Cell[];

  /** Step 1 of the tick, and whether a steering request is taken at all. */
  readonly steering: boolean;
  /** Steps 2 to 5 of the tick. */
  readonly travel: boolean;
  /** The placement inside step 5. */
  readonly pelletRespawn: boolean;
  /**
   * The cell `setNextPellet` posed for the next spawn, or `null` while none
   * stands. The spawn that consumes it decides whether it is valid.
   */
  readonly nextPellet: Cell | null;

  /** Game time held past the last whole tick, carried into the next update. */
  readonly accumulator: number;
  /** Seconds left of the head's bite; `0` is the resting pose. */
  readonly biteRemaining: number;
  /** The produced sprite set, loaded once before the first frame. */
  readonly sprites: SnakeSprites;
}

/**
 * The slack the accumulator allows a tick boundary.
 *
 * A second delivered as sixty updates of a sixtieth each sums to a hair under a
 * second in binary floating point, and the specification requires it to resolve
 * the same eight ticks a second delivered in one update does. Comparing against
 * the boundary less this tolerance is what makes the two agree. It is far smaller
 * than any interval a caller can mean, so it never lets an early tick through.
 */
const TICK_EPSILON = 1e-9;

/** The actions that steer, and the direction each one asks for. */
const STEER: Partial<Record<ActionName, Direction>> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
};

// ---- Building and restoring the session ----------------------------------

/**
 * The whole opening state: the title screen, a fresh round laid out but not
 * started, the mode's obstacle course, no posed pellet cell, and all three
 * driver switches on.
 *
 * `sprites` and `muted` are the two things a session carries in from outside it —
 * the files the engine loaded and the player's sound preference — so both are
 * handed in rather than decided here.
 */
export function createInitialState(
  sprites: SnakeSprites,
  muted: boolean,
): CoilState {
  return layChain({
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    pressedItem: null,
    score: 0,
    best: 0,
    combo: 1,
    comboWindow: 0,
    muted,
    ticks: 0,
    simTime: 0,
    dir: "right",
    turns: [],
    snake: [],
    pellet: null,
    obstacles: OBSTACLE_CELLS.map((cell) => ({ col: cell.col, row: cell.row })),
    steering: true,
    travel: true,
    pelletRespawn: true,
    nextPellet: null,
    accumulator: 0,
    biteRemaining: 0,
    sprites,
  });
}

/**
 * Every field the snapshot reports back to its opening value, the course back to
 * the mode's, the three switches back on, and no posed pellet cell.
 *
 * `muted` is untouched, because muting is a player preference rather than a value
 * a round opens with, and the sprites are kept because they are the files the
 * engine loaded rather than anything a round decides.
 */
export function resetSession(state: CoilState): CoilState {
  return createInitialState(state.sprites, state.muted);
}

/** Begin a round: the board as `specs/board.md` lays it, with its first pellet. */
export function startRound(state: CoilState): CoilState {
  const laid = layChain({
    ...state,
    screen: "playing",
    menuIndex: 0,
    accumulator: 0,
    biteRemaining: 0,
    pellet: null,
  });
  // Placed after the chain is laid, so it never lands under a starting cell.
  return spawnPellet(laid).state;
}

/**
 * Move to `screen` and highlight the item it opens on.
 *
 * The title opens on its remembered selection, so leaving how-to-play lands back
 * on the entry that opened it and a round left for the title lands back on the
 * entry that started it (`specs/ui.md`). Every other screen opens on its first
 * item.
 */
export function goTo(state: CoilState, screen: Screen): CoilState {
  return {
    ...state,
    screen,
    menuIndex: screen === "title" ? state.titleIndex : 0,
  };
}

// ---- Routing one press edge ----------------------------------------------

/**
 * What routing one press edge left: the next state, and whether it laid a fresh
 * round out.
 *
 * The second is there because it is the one thing routing does that the state
 * cannot record. `specs/ui.md` sounds the music bed when "a round begins", and
 * three menu items lay a fresh round while a fourth returns to the round already
 * running — all four leaving `screen` at `playing`. Reporting it keeps this file
 * pure, as its own header requires, while still letting `update`, which holds the
 * bus, sound the cue on exactly the frames a round began on.
 */
export interface Routed {
  state: CoilState;
  /** Whether this edge laid a fresh round out. */
  roundBegan: boolean;
}

/** Routing that laid no round out. */
function routed(state: CoilState): Routed {
  return { state, roundBegan: false };
}

/** Routing that laid a fresh round out. */
function began(state: CoilState): Routed {
  return { state, roundBegan: true };
}

/**
 * Route one press edge to what it does on the screen the game is on
 * (specs/controls.md).
 *
 * Pure, and deliberately blind to `mute`: muting is the engine's bit rather than a
 * field of the state, so `update` reads that edge and flips the bus, and this
 * routes everything else.
 */
export function handleAction(state: CoilState, action: ActionName): Routed {
  if (state.screen === "playing") {
    const dir = STEER[action];
    if (dir) return routed(requestTurn(state, dir));
    if (action === "back" || action === "pause") {
      return routed(goTo(state, "paused"));
    }
    return routed(state);
  }
  return routeMenu(state, action);
}

function routeMenu(state: CoilState, action: ActionName): Routed {
  const items = menuItems(state.screen);
  switch (action) {
    case "up":
      if (items.length === 0) return routed(state);
      return routed({
        ...state,
        menuIndex: (state.menuIndex - 1 + items.length) % items.length,
      });
    case "down":
      if (items.length === 0) return routed(state);
      return routed({
        ...state,
        menuIndex: (state.menuIndex + 1) % items.length,
      });
    case "confirm":
      return accept(state);
    case "back":
      return routed(leave(state));
    case "pause":
      return routed(state.screen === "paused" ? goTo(state, "playing") : state);
    default:
      return routed(state);
  }
}

/**
 * Accept the highlighted item of the current screen's menu.
 *
 * Keyed by the item's index rather than by its label, so the title's first item
 * starts a round whatever the mode names it.
 */
function accept(base: CoilState): Routed {
  const index = base.menuIndex;
  // The title remembers what was confirmed on it, whichever input confirmed it.
  const state = base.screen === "title" ? { ...base, titleIndex: index } : base;
  switch (state.screen) {
    case "title":
      return index === 0
        ? began(startRound(state))
        : routed(goTo(state, "howto"));
    case "howto":
      return routed(goTo(state, "title"));
    case "paused":
      if (index === 0) return routed(goTo(state, "playing"));
      if (index === 1) return began(startRound(state));
      return routed(goTo(state, "title"));
    case "gameover":
    case "cleared":
      return index === 0
        ? began(startRound(state))
        : routed(goTo(state, "title"));
    default:
      return routed(state);
  }
}

/**
 * Route one pointer or touch sample over the current screen's menu
 * (`specs/ui.md`).
 *
 * A sample carries the logical stage units the menus are laid out in. A move,
 * and a contact landing, select the item they are over; a press and the release
 * that answers it confirm the item when both fell inside the one region, so a
 * press slid off its entry confirms nothing. The `playing` screen shows no menu,
 * so nothing there is read.
 */
function handlePointer(state: CoilState, sample: PointerSample): Routed {
  if (state.screen === "playing") {
    return routed({ ...state, pressedItem: null });
  }
  const item = menuItemAt(state.screen, sample.x, sample.y);
  const selected = item === null ? state : { ...state, menuIndex: item };
  if (sample.type === "move") return routed(selected);
  if (sample.type === "down") return routed({ ...selected, pressedItem: item });
  const armed = selected.pressedItem;
  const released: CoilState = { ...selected, pressedItem: null };
  if (item === null || item !== armed) return routed(released);
  return accept(released);
}

/** Leave the current screen for the one it was reached from. */
function leave(state: CoilState): CoilState {
  switch (state.screen) {
    case "howto":
    case "gameover":
    case "cleared":
      return goTo(state, "title");
    case "paused":
      return goTo(state, "playing");
    default:
      return state;
  }
}

// ---- The frame -----------------------------------------------------------

/** The head's sprite frame: 0 at rest, and 1 to 3 through the bite an eat began. */
export function biteFrame(state: { readonly biteRemaining: number }): number {
  // The remainder is compared against a tolerance rather than zero, because a
  // caller that delivers BITE_SECONDS in sixty updates leaves a float dust behind
  // that a caller delivering it in one does not, and the two must agree.
  if (state.biteRemaining <= 1e-6) return 0;
  const spent = BITE_SECONDS - state.biteRemaining;
  return 1 + Math.min(2, Math.floor((spent / BITE_SECONDS) * 3));
}

/**
 * Resolve every whole tick the accumulator holds, playing each tick's cues on the
 * tick it resolves.
 *
 * A tick that ends the round moves the game off the `playing` screen, and the loop
 * stops there: nothing advances once a round is over. The time the update was
 * still carrying past that tick is SPENT rather than banked
 * (`specs/movement.md`) — held back, it would be waiting the moment a game was
 * put back on `playing` and would march the chain several cells on the first
 * update after that.
 */
function runTicks(state: CoilState, api: UpdateApi): CoilState {
  let next = state;
  while (next.accumulator >= TICK_SECONDS - TICK_EPSILON) {
    const result = tick({
      ...next,
      accumulator: next.accumulator - TICK_SECONDS,
    });
    next = result.state;
    if (result.events.ate) next = { ...next, biteRemaining: BITE_SECONDS };
    playTickEvents(api, result.events);
    if (result.ended !== null) {
      next = goTo(
        { ...next, accumulator: 0 },
        result.ended === "cleared" ? "cleared" : "gameover",
      );
      break;
    }
  }
  return next;
}

/**
 * Sound the music bed for a round that has just begun (specs/ui.md).
 *
 * `specs/ui.md` plays `music` when "a round begins", so it is played from the one
 * path that LAYS A ROUND OUT rather than reconciled against the screen. A screen
 * reaching `playing` is not a round beginning: `RESUME` returns to the round
 * already running, and `specs/instrumentation.md` says of a posed screen that it
 * "runs the tick over the board as it stands rather than laying out a fresh
 * round". Reconciling would sound the bed on both.
 *
 * A bed already running is stopped first, so a fresh round always starts the bed
 * fresh — `RESTART` from the pause menu leaves the previous round's bed playing
 * otherwise, and that round has ended.
 */
function startMusic(api: UpdateApi): void {
  if (api.audio.looping(CUES.music)) api.audio.stop(CUES.music);
  api.audio.loop(CUES.music);
}

/**
 * Stop the music bed once the round it was playing under is over (specs/ui.md:
 * "Once the round has ended the bed is stopped rather than left running
 * quietly").
 *
 * Reconciled every frame rather than stopped at the transitions, because a round
 * can also be left through the debug surface. Only the STOP is reconciled this
 * way: see {@link startMusic} for why the start is not.
 */
function stopMusicOffTheRound(state: CoilState, api: UpdateApi): void {
  const under = state.screen === "playing" || state.screen === "paused";
  if (!under && api.audio.looping(CUES.music)) api.audio.stop(CUES.music);
}

// ---- The game the engine drives ------------------------------------------

export const game: Game<CoilState, CoilDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * declare the four cues and load the produced file behind each, load the sprite
   * set, register the diagnostic sources, and build the complete initial state.
   *
   * Neither the diagnostics nor the surface holds the state: a source is handed
   * the state current at the read, and every operation on the surface takes the
   * state it poses and returns the next one (specs/instrumentation.md).
   */
  async initialize(
    api: InitApi<CoilState>,
  ): Promise<[CoilState, CoilDebugApi]> {
    registerActions(api);
    registerDiagnostics(api);
    const [sprites] = await Promise.all([loadSprites(api), defineCues(api)]);
    return [createInitialState(sprites, false), createDebugApi()];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * The action edges are read first and exactly once each — they are news for one
   * frame only — then the elapsed seconds are consumed into whole ticks on the
   * `playing` screen alone, then the bite winds down, and the two things the state
   * mirrors rather than owns, the best score and the engine's mute bit, are
   * refreshed on the state the frame leaves behind.
   */
  update(
    state: DeepReadonly<CoilState>,
    api: UpdateApi,
    dt: number,
  ): CoilState {
    let next: CoilState = state;

    for (const action of pressedActions(api)) {
      if (action === "mute") {
        api.audio.setMuted(!api.audio.muted());
        continue;
      }
      const result = handleAction(next, action);
      next = result.state;
      // The one thing routing does that the state cannot record: a round BEGAN,
      // which `specs/ui.md` sounds the music bed on.
      if (result.roundBegan) startMusic(api);
    }

    // After the frame's keyboard edges, as `specs/ui.md` states.
    for (const sample of api.input.pointerSamples()) {
      const result = handlePointer(next, sample);
      next = result.state;
      if (result.roundBegan) startMusic(api);
    }

    if (next.screen === "playing") {
      next = runTicks(
        {
          ...next,
          simTime: next.simTime + dt,
          accumulator: next.accumulator + dt,
        },
        api,
      );
    }
    stopMusicOffTheRound(next, api);

    return {
      ...next,
      // The bite runs on the ROUND'S own time (`specs/assets.md`), so it holds
      // the frame it is on behind a pause and on every menu screen, and carries
      // on from there when the round resumes.
      biteRemaining:
        next.screen === "playing"
          ? Math.max(0, next.biteRemaining - dt)
          : next.biteRemaining,
      // The best rises the instant the live score passes it, during play rather
      // than at the end of a round, so a best posed below the live score is
      // raised back to it on the very next update.
      best: Math.max(next.best, next.score),
      muted: api.audio.muted(),
    };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: DeepReadonly<CoilState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
